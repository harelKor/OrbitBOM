// Runs against a real Postgres when TEST_DATABASE_URL is set. Onshape and R2 are a fake fetch.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

const DID = "0123456789abcdef01234567";
const WID = "89abcdef0123456789abcdef";
const EID = "fedcba9876543210fedcba98";

if (!url) describe.skip("thumbnails and export (database): set TEST_DATABASE_URL", () => {});
else
  describe("thumbnails and export (database)", async () => {
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
    const { refreshThumbnails, thumbKey } = await import("./thumbnails");
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

    it("fetches thumbnails once, and again only for changed parts", async () => {
      let s = await refreshThumbnails(system.id, member.id, Date.now() + 30_000);
      // The parts list, two part images, and the assembly's thumbnail sizes and picture.
      expect(s).toEqual({ fetched: 2, pending: 0, calls: 5 });
      expect(bucket.get(thumbKey(plate.id, "mvA1"))).toBe("png:/thumb/A/mvA1");
      const [sys] = await db.select().from(schema.systems).where(eq(schema.systems.id, system.id));
      expect(sys.thumbnailPath).toMatch(new RegExp(`^thumbs/systems/${system.id}/`));
      expect(bucket.get(sys.thumbnailPath!)).toBe("png:/thumb/assembly/1");

      s = await refreshThumbnails(system.id, member.id, Date.now() + 30_000);
      expect(s).toEqual({ fetched: 0, pending: 0, calls: 3 });

      microversions = { ...microversions, B: "mvB2" };
      s = await refreshThumbnails(system.id, member.id, Date.now() + 30_000);
      expect(s.fetched).toBe(1);
      expect(bucket.has(thumbKey(tube.id, "mvB1"))).toBe(false);
      expect(bucket.has(thumbKey(tube.id, "mvB2"))).toBe(true);
      const [row] = await db.select().from(schema.parts).where(eq(schema.parts.id, tube.id));
      expect(row.thumbnailRev).toBe("mvB2");
      expect(row.geometry?.bodyType).toBe("solid");
      expect(row.geometry?.sheetMetal).toBeUndefined();
      const [sheet] = await db.select().from(schema.parts).where(eq(schema.parts.id, plate.id));
      expect(sheet.geometry?.sheetMetal).toEqual({ flatPartId: "AF" });
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
