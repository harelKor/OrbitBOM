// Runs against a real Postgres when TEST_DATABASE_URL is set. Onshape and R2 are a fake fetch.
// Sheet metal in Auto Layout (2026-11-04): a sheet metal part is laid out, drawn and placed in
// Onshape as its flat pattern.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

const DID = "0123456789abcdef01234567";
const WID = "89abcdef0123456789abcdef";
const EID = "fedcba9876543210fedcba98";
const SEID = "cccccccccccccccccccccccc"; // the part's Part Studio
const LDID = "aaaaaaaaaaaaaaaaaaaaaaaa"; // the robot's Batch Layouts document
const LWID = "bbbbbbbbbbbbbbbbbbbbbbbb";

// A 200 × 100 × 3 mm plate lying on z = 0 (metres), as Onshape tessellates a flat body.
function plateBody(id: string) {
  const [X, Y, Z] = [0.2, 0.1, 0.003];
  const v = (x: number, y: number, z: number) => ({ x, y, z });
  const quad = (a: object, b: object, c: object, d: object) => [{ vertices: [a, b, c] }, { vertices: [a, c, d] }];
  const p = [v(0, 0, 0), v(X, 0, 0), v(X, Y, 0), v(0, Y, 0), v(0, 0, Z), v(X, 0, Z), v(X, Y, Z), v(0, Y, Z)];
  const faces = [
    quad(p[0], p[3], p[2], p[1]),
    quad(p[4], p[5], p[6], p[7]),
    quad(p[0], p[1], p[5], p[4]),
    quad(p[1], p[2], p[6], p[5]),
    quad(p[2], p[3], p[7], p[6]),
    quad(p[3], p[0], p[4], p[7]),
  ].map((facets, i) => ({ id: `f${i}`, facets }));
  return { id, faces, appearance: { color: [200, 200, 200] } };
}

if (!url) describe.skip("sheet metal in Auto Layout (database): set TEST_DATABASE_URL", () => {});
else
  describe("sheet metal in Auto Layout (database)", async () => {
    process.env.DATABASE_URL = url;
    process.env.ONSHAPE_TOKEN_KEY = randomBytes(32).toString("base64");
    Object.assign(process.env, { R2_ENDPOINT: "https://r2.test", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" });
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { encrypt } = await import("@/lib/crypto");
    const { batchFlatParts } = await import("./batchLayout");
    const { pushOnshapeLayout } = await import("./onshapeLayout");
    const { plateDxf } = await import("@/lib/drawing/plateDxf");
    const { onshapeClient } = await import("@/lib/onshape/client");

    const bucket = new Map<string, Uint8Array>();
    const onshape: string[] = [];
    const inserted: unknown[] = [];
    vi.stubGlobal("fetch", async (input: string | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      const u = new URL(req.url);
      if (u.host === "r2.test") {
        const key = decodeURIComponent(u.pathname.replace(/^\/b\//, ""));
        if (req.method === "PUT") bucket.set(key, new Uint8Array(await req.arrayBuffer()));
        const has = bucket.has(key);
        return new Response(req.method === "HEAD" || !has ? null : (bucket.get(key) as BodyInit), { status: has ? 200 : 404 });
      }
      const path = u.pathname.replace("/api/v10/", "");
      onshape.push(`${req.method} ${path}${u.searchParams.has("partId") ? `?partId=${u.searchParams.get("partId")}` : ""}`);
      const json = (b: unknown) => new Response(JSON.stringify(b));
      // The flat body's shape: only the flat body, never the folded part.
      if (path.endsWith("/tessellatedfaces")) return json({ bodies: u.searchParams.get("partId") === "AF" ? [plateBody("AF")] : [] });
      if (path.startsWith("parts/") && path.includes("withThumbnails=false")) return json([]);
      if (path.startsWith("parts/") && path.endsWith("/appearances")) return json([]);
      // The flat STEP export, then its import into the Layouts document.
      if (req.method === "POST" && path.endsWith(`/e/${SEID}/translations`)) return json({ id: "exp", requestState: "DONE", documentId: DID, resultExternalDataIds: ["x1"] });
      if (path.includes("/externaldata/x1")) return new Response("ISO-10303-21 flat");
      if (req.method === "POST" && path === `translations/d/${LDID}/w/${LWID}`) {
        expect(req.headers.get("content-type")).toMatch(/^multipart\/form-data/);
        return json({ id: "imp", requestState: "ACTIVE", documentId: LDID });
      }
      if (path === "translations/imp") return json({ id: "imp", requestState: "DONE", documentId: LDID, resultElementIds: ["impE"] });
      if (path === `parts/d/${LDID}/w/${LWID}/e/impE`) return json([{ partId: "JFD" }]);
      if (req.method === "POST" && path === `assemblies/d/${LDID}/w/${LWID}`) return json({ id: "asmE" });
      if (req.method === "POST" && path.endsWith("/transformedinstances")) {
        inserted.push(await req.json());
        return json({});
      }
      return new Response("not found", { status: 404 });
    });

    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Sheet Tester", onshapeConnected: true }).returning();
    await db.insert(schema.onshapeTokens).values({ memberId: member.id, accessTokenEnc: encrypt("access"), refreshTokenEnc: encrypt("refresh"), expiresAt: new Date(Date.now() + 3600_000) });
    const [robot] = await db
      .insert(schema.robots)
      .values({ name: "Sheet bot", year: 2027, layoutsDocumentUrl: `https://cad.onshape.com/documents/${LDID}/w/${LWID}`, layoutsDocumentId: LDID, layoutsWorkspaceId: LWID })
      .returning();
    const [system] = await db
      .insert(schema.systems)
      .values({ robotId: robot.id, name: "Intake", assemblyUrl: `https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}` })
      .returning();
    const [part] = await db
      .insert(schema.parts)
      .values({ systemId: system.id, sourceDid: DID, sourceWvm: "w", sourceWid: WID, sourceEid: SEID, onshapePartId: "A", onshapeName: "Bent plate", quantity: 2, thumbnailRev: "mvA1", geometry: { sheetMetal: { flatPartId: "AF" } } })
      .returning();
    const [group] = await db.insert(schema.partGroups).values({ robotId: robot.id, name: "Laser 1", machine: "laser" }).returning();
    await db.insert(schema.groupMembers).values({ groupId: group.id, partId: part.id, keySnapshot: {} });
    const row = { part, assemblyUrl: system.assemblyUrl, robotId: robot.id };

    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("lays out a sheet metal part as its flat pattern, fetched once", async () => {
      // Without Onshape connected and nothing saved yet: listed as missing, no Onshape call.
      let got = await batchFlatParts(group.id);
      expect(got.parts).toEqual([]);
      expect(got.missing[0].reason).toMatch(/flat pattern isn't saved yet/);
      expect(onshape).toEqual([]);

      got = await batchFlatParts(group.id, member);
      expect(onshape.filter((c) => c.includes("tessellatedfaces"))).toEqual([`GET partstudios/d/${DID}/w/${WID}/e/${SEID}/tessellatedfaces?partId=AF`]);
      const [flat] = got.parts;
      expect(flat).toMatchObject({ partId: part.id, onshapePartId: "AF", sheetMetal: true, quantity: 2, plate: true });
      expect([Math.round(flat.w), Math.round(flat.h), Math.round(flat.thickness)]).toEqual([200, 100, 3]);
      expect(bucket.has(flat.meshFile)).toBe(true);

      // Saved in R2: the next open (with or without Onshape) calls Onshape no more.
      const before = onshape.length;
      expect((await batchFlatParts(group.id)).parts[0]).toMatchObject({ onshapePartId: "AF", sheetMetal: true });
      expect(onshape.length).toBe(before);
    });

    it("draws its flat DXF from the flat pattern, without an Onshape DXF translation", async () => {
      const before = onshape.length;
      const text = await plateDxf(row, member, true, Date.now() + 10_000);
      expect(text).toContain("CUT");
      expect(onshape.length).toBe(before);
      expect([...bucket.keys()].some((k) => k === `exports/${part.id}/mvA1.flat1.dxf`)).toBe(true);
    });

    it("places its imported flat STEP in Onshape Layout, imported once", async () => {
      const placements = [
        { partId: part.id, copy: 0, x: 10, y: 10, rotation: 0 },
        { partId: part.id, copy: 1, x: 10, y: 120, rotation: 0 },
      ];
      const client = onshapeClient(member.id, "https://cad.onshape.com");
      const out = await pushOnshapeLayout(client, group.id, placements);
      expect(out).toMatchObject({ copies: 2, skipped: [] });
      // Exported (into R2), imported into the Layouts document, and its part looked up.
      expect(onshape.filter((c) => c.startsWith("POST") && c.includes("translations"))).toEqual([`POST partstudios/d/${DID}/w/${WID}/e/${SEID}/translations`, `POST translations/d/${LDID}/w/${LWID}`]);
      expect(bucket.get(`exports/${part.id}/mvA1.flat.step`)).toBeDefined();
      const body = inserted.at(-1) as { transformGroups: { instances: Record<string, unknown>[]; transform: number[] }[] };
      expect(body.transformGroups).toHaveLength(2);
      // The imported part, live from the same document (no version), not the folded one.
      expect(body.transformGroups[0].instances[0]).toEqual({ documentId: LDID, elementId: "impE", partId: "JFD", isAssembly: false, isWholePartStudio: false });
      const [saved] = await db.select({ data: schema.partGroups.layoutData }).from(schema.partGroups).where(eq(schema.partGroups.id, group.id));
      expect(saved.data?.flatImports?.[`${LDID}|${part.id}`]).toMatchObject({ eid: "impE", partId: "JFD" });

      // Again: the imported tab is checked (one call) and reused.
      onshape.length = 0;
      await pushOnshapeLayout(onshapeClient(member.id, "https://cad.onshape.com"), group.id, placements);
      expect(onshape.filter((c) => c.includes("translations"))).toEqual([]);
      expect(onshape).toContain(`GET parts/d/${LDID}/w/${LWID}/e/impE`);
    });
  });
