// Runs against a real Postgres when TEST_DATABASE_URL is set. Onshape and R2 are a fake fetch.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

const DID = "0123456789abcdef01234567";
const WID = "89abcdef0123456789abcdef";
const EID = "fedcba9876543210fedcba98";

if (!url) describe.skip("part data and export (database): set TEST_DATABASE_URL", () => {});
else
  describe("part data and export (database)", async () => {
    process.env.DATABASE_URL = url;
    process.env.ONSHAPE_TOKEN_KEY = randomBytes(32).toString("base64");
    Object.assign(process.env, {
      R2_ENDPOINT: "https://r2.test",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_BUCKET: "b",
    });
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { encrypt } = await import("@/lib/crypto");
    const { refreshPartData } = await import("./thumbnails");
    const { exportPart } = await import("./export");
    const { onshapeClient } = await import("./client");

    const bucket = new Map<string, string>();
    const onshape: string[] = [];
    let microversions: Record<string, string> = { A: "mvA1", B: "mvB1" };
    let translationPolls = 0;
    vi.stubGlobal("fetch", async (input: string | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      const u = new URL(req.url);
      if (u.host === "r2.test") {
        const key = decodeURIComponent(u.pathname.replace(/^\/b\//, ""));
        if (req.method === "PUT") bucket.set(key, await req.text());
        if (req.method === "DELETE") bucket.delete(key);
        return new Response(bucket.get(key) ?? null, { status: req.method === "HEAD" && !bucket.has(key) ? 404 : 200 });
      }
      onshape.push(`${req.method} ${u.pathname}`);
      const json = (b: unknown) => new Response(JSON.stringify(b));
      // The Part Studio's own revision moves whenever one of its parts does.
      if (u.pathname.endsWith("/elements")) return json([{ id: "studio", microversionId: Object.values(microversions).join("+") }]);
      if (u.pathname.startsWith("/api/v10/parts/") && u.searchParams.has("withThumbnails")) {
        const listed = Object.entries(microversions).map(([partId, mv]) => ({
          partId,
          bodyType: "solid",
          microversionId: mv,
          thumbnailInfo: { sizes: [{ size: "300x300", href: `https://cad.onshape.com/thumb/${partId}/${mv}` }] },
        }));
        // Part A is sheet metal: with includeFlatParts its flat pattern is listed too.
        const flat = u.searchParams.get("includeFlatParts") === "true" ? [{ partId: "AF", bodyType: "solid", isFlattenedBody: true, unflattenedPartId: "A" }] : [];
        return json([...listed, ...flat]);
      }
      if (u.pathname.startsWith("/api/v10/thumbnails/")) {
        return json({ sizes: [{ size: "300x300", href: "https://cad.onshape.com/thumb/assembly/1" }] });
      }
      if (u.pathname.startsWith("/thumb/")) return new Response(`png:${u.pathname}`, { headers: { "content-type": "image/png" } });
      if (u.pathname.endsWith("/stl")) return new Response("solid stl");
      if (u.pathname.endsWith("/translations")) return json({ id: "t1", requestState: "ACTIVE", documentId: DID });
      if (u.pathname.endsWith("/translations/t1")) {
        translationPolls++;
        return json({ id: "t1", requestState: "DONE", documentId: DID, resultExternalDataIds: ["x1"] });
      }
      if (u.pathname.includes("/externaldata/x1")) return new Response("ISO-10303-21");
      return new Response("not found", { status: 404 });
    });

    // Answers kept under a Part Studio's revision from an earlier run would skip the calls counted here.
    const { sql: raw } = await import("drizzle-orm");
    await db.delete(schema.onshapeCache).where(raw`key like ${`%${DID}%`}`);
    const userId = randomUUID();
    const [member] = await db
      .insert(schema.members)
      .values({ userId, email: `${userId}@t.org`, name: "Thumb Tester", onshapeConnected: true })
      .returning();
    await db.insert(schema.onshapeTokens).values({
      memberId: member.id,
      accessTokenEnc: encrypt("access"),
      refreshTokenEnc: encrypt("refresh"),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const [robot] = await db.insert(schema.robots).values({ name: "Thumb bot", year: 2027 }).returning();
    const [system] = await db
      .insert(schema.systems)
      .values({ robotId: robot.id, name: "Drive", assemblyUrl: `https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}` })
      .returning();
    const source = { systemId: system.id, sourceDid: DID, sourceWvm: "w", sourceWid: WID, sourceEid: "studio" };
    const inserted = await db
      .insert(schema.parts)
      .values([
        { ...source, onshapePartId: "A", onshapeName: "Plate" },
        { ...source, onshapePartId: "B", onshapeName: "Tube" },
      ])
      .returning();
    const plate = inserted.find((p) => p.onshapePartId === "A")!;
    const tube = inserted.find((p) => p.onshapePartId === "B")!;

    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("reads each Part Studio's parts list once per revision, for sheet metal and body types", async () => {
      onshape.length = 0;
      let s = await refreshPartData(system.id, member.id);
      // The workspace's Part Studio revisions, and the parts list: no thumbnail images any more.
      expect(s).toEqual({ calls: 2, studios: 1 });
      expect(onshape.some((c) => c.includes("/thumb"))).toBe(false);
      const [sheet] = await db.select().from(schema.parts).where(eq(schema.parts.id, plate.id));
      expect(sheet.geometry?.sheetMetal).toEqual({ flatPartId: "AF" });
      const [row] = await db.select().from(schema.parts).where(eq(schema.parts.id, tube.id));
      expect([row.geometry?.bodyType, row.geometry?.sheetMetal]).toEqual(["solid", undefined]);

      // Nothing edited: the revisions only (1 call), the list is kept.
      s = await refreshPartData(system.id, member.id);
      expect(s).toEqual({ calls: 1, studios: 1 });

      // A part changed: its Part Studio's list is read again.
      microversions = { ...microversions, B: "mvB2" };
      s = await refreshPartData(system.id, member.id);
      expect(s).toEqual({ calls: 2, studios: 1 });

      // Only the Part Studios a commit changed.
      s = await refreshPartData(system.id, member.id, { only: new Set(["d/other/w/x/e/y"]) });
      expect(s).toEqual({ calls: 0, studios: 0 });
    });

    it("exports STL directly and STEP through a translation", async () => {
      const client = onshapeClient(member.id, "https://cad.onshape.com");
      const studio = `d/${DID}/w/${WID}/e/studio`;
      expect(new TextDecoder().decode(await exportPart(client, studio, "A", "STL", Date.now() + 10_000))).toBe("solid stl");
      expect(new TextDecoder().decode(await exportPart(client, studio, "A", "STEP", Date.now() + 10_000))).toBe(
        "ISO-10303-21",
      );
      expect(translationPolls).toBe(1);
      expect(client.calls).toBe(4);
    });
  });
