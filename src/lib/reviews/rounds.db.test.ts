// Runs against a real Postgres when TEST_DATABASE_URL is set. Onshape and R2 are a fake fetch.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

const DID = "4123456789abcdef01234567"; // the students' CAD document
const WID = "b9abcdef0123456789abcdef";
const EID = "cedcba9876543210fedcba98"; // its assembly
const S1 = "d00000000000000000000001"; // two Part Studios in it
const S2 = "d00000000000000000000002";
const LDID = "5123456789abcdef01234567"; // a library document inserted at a version
const LS = "e00000000000000000000001";

if (!url) describe.skip("CAD Review rounds (database): set TEST_DATABASE_URL", () => {});
else
  describe("CAD Review rounds (database)", async () => {
    process.env.DATABASE_URL = url;
    process.env.ONSHAPE_TOKEN_KEY = randomBytes(32).toString("base64");
    Object.assign(process.env, { R2_ENDPOINT: "https://r2.test", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" });
    const { db, schema } = await import("@/db");
    const { eq, like, or } = await import("drizzle-orm");
    const { encrypt } = await import("@/lib/crypto");
    const { buildRoundStep, roundModel, sendRound } = await import("./rounds");
    const { checkSystem } = await import("@/lib/versions/detect");

    const bucket = new Map<string, string>();
    const onshape: string[] = [];
    let microversion = "mv1";
    let elementRevs: Record<string, string> = { [S1]: "e1a", [S2]: "e2a" };
    let versions = [{ id: "v1", name: "V1", createdAt: "2026-11-01T10:00:00Z" }];
    const instance = (id: string, eid: string, partId: string, name: string, did = DID, version?: string) => ({
      id,
      type: "Part",
      name: `${name} <1>`,
      documentId: did,
      elementId: eid,
      partId,
      ...(version ? { documentVersion: version } : {}),
    });
    vi.stubGlobal("fetch", async (input: string | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      const u = new URL(req.url);
      if (u.host === "r2.test") {
        const key = decodeURIComponent(u.pathname.replace(/^\/b\//, ""));
        if (req.method === "PUT") bucket.set(key, await req.text());
        return new Response(bucket.get(key) ?? null, { status: req.method === "HEAD" && !bucket.has(key) ? 404 : 200 });
      }
      const path = u.pathname.replace(/^\/api\/v\d+\//, "");
      onshape.push(`${req.method} ${path}`);
      const json = (b: unknown) => new Response(JSON.stringify(b));
      if (path.endsWith("/currentmicroversion")) return json({ microversion });
      if (path.startsWith(`documents/d/${DID}/`) && path.endsWith("/elements")) return json(Object.entries(elementRevs).map(([id, microversionId]) => ({ id, microversionId })));
      if (path.startsWith(`documents/d/${LDID}/v/lv1/elements`)) return json([{ id: LS, microversionId: "l1" }]);
      if (path === `documents/d/${DID}/versions`) return json(versions);
      if (path.startsWith("assemblies/") && path.endsWith("/bom")) {
        const v = path.match(/\/v\/(\w+)\//)?.[1] ?? "?";
        return json({
          headers: [
            { id: "n", name: "Name" },
            { id: "q", name: "Quantity" },
          ],
          rows: [{ itemSource: { documentId: DID, elementId: S1, partId: "P1", wvmType: "v", wvmId: v }, headerIdToValue: { n: "Plate", q: 1 } }],
        });
      }
      if (path.startsWith("assemblies/"))
        return json({
          rootAssembly: {
            instances: [instance("i1", S1, "P1", "Plate"), instance("i2", S2, "P2", "Spacer"), instance("i3", LS, "L1", "Bearing", LDID, "lv1")],
            occurrences: ["i1", "i2", "i3"].map((id) => ({ path: [id], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] })),
          },
        });
      if (path.includes("/tessellatedfaces")) return json([]);
      return new Response("not found", { status: 404 });
    });

    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Review Tester", onshapeConnected: true }).returning();
    await db.insert(schema.onshapeTokens).values({ memberId: member.id, accessTokenEnc: encrypt("access"), refreshTokenEnc: encrypt("refresh"), expiresAt: new Date(Date.now() + 3600_000) });
    const [robot] = await db.insert(schema.robots).values({ name: "Review bot", year: 2027 }).returning();
    const assemblyUrl = `https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}`;
    const [review] = await db.insert(schema.designReviews).values({ robotId: robot.id, title: "Intake v2", assemblyUrl, ownerId: member.id }).returning();

    // Element lists of versions and microversions are kept for good: a run starts without them.
    const clearKept = () =>
      db.delete(schema.onshapeCache).where(or(like(schema.onshapeCache.key, `element-revs:${DID}:%`), like(schema.onshapeCache.key, `element-revs:${LDID}:%`)));
    await clearKept();
    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
      await clearKept();
    });

    const tessellations = () => onshape.filter((c) => c.includes("tessellatedfaces"));

    it("freezes the assembly at its microversion and builds round 1 once", async () => {
      onshape.length = 0;
      const round = await sendRound(review.id, member.id, "First look");
      expect(round.seq).toBe(1);
      expect(onshape).toEqual([`GET documents/d/${DID}/w/${WID}/currentmicroversion`]);
      onshape.length = 0;
      expect((await buildRoundStep(round.id, member.id, Date.now() + 60_000)).state).toBe("ready");
      // The definition at the frozen microversion, one element list per document context, one
      // export per Part Studio, and nothing read from the live workspace.
      expect(onshape.filter((c) => c.startsWith("GET assemblies/"))).toEqual([expect.stringContaining(`assemblies/d/${DID}/m/mv1/e/${EID}`)]);
      expect(onshape.filter((c) => c.includes("/elements"))).toHaveLength(2);
      expect(tessellations()).toHaveLength(3);
      expect(onshape.some((c) => c.includes(`/w/${WID}`))).toBe(false);

      const model = await roundModel(round.id);
      expect(model?.studios).toHaveLength(3);
      expect(model?.names).toMatchObject({ [`${DID}:${S1}:P1`]: "Plate", [`${LDID}:${LS}:L1`]: "Bearing" });
    });

    it("re-exports only the Part Studio that changed in round 2", async () => {
      microversion = "mv2";
      elementRevs = { [S1]: "e1b", [S2]: "e2a" };
      const round = await sendRound(review.id, member.id, "Thicker plate");
      onshape.length = 0;
      expect((await buildRoundStep(round.id, member.id, Date.now() + 60_000)).state).toBe("ready");
      // The library version's list is kept, so only the CAD document's is read again.
      expect(onshape.filter((c) => c.includes("/elements"))).toHaveLength(1);
      expect(tessellations()).toEqual([expect.stringContaining(`partstudios/d/${DID}/m/mv2/e/${S1}/`)]);
      const [r] = await db.select().from(schema.reviewRounds).where(eq(schema.reviewRounds.id, round.id));
      expect(r.calls).toBe(3);
    });

    it("refuses a round of the same Onshape state", async () => {
      await expect(sendRound(review.id, member.id, null)).rejects.toThrow("Nothing changed in Onshape since round 2.");
    });

    it("a system that follows versions reads the newest version, not the workspace", async () => {
      const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Intake", assemblyUrl, followVersions: true }).returning();
      onshape.length = 0;
      const first = await checkSystem(system.id, member.id);
      expect(first.draft?.changes.map((c) => c.name)).toEqual(["Plate"]);
      expect(onshape).toEqual([`GET documents/d/${DID}/versions`, expect.stringContaining(`assemblies/d/${DID}/v/v1/e/${EID}/bom`)]);

      // Students keep editing (a new microversion): the next check stops after 1 call.
      microversion = "mv3";
      onshape.length = 0;
      expect((await checkSystem(system.id, member.id, { force: false })).unchanged).toBe(true);
      expect(onshape).toEqual([`GET documents/d/${DID}/versions`]);

      // A new Onshape version is read at that version.
      versions = [...versions, { id: "v2", name: "V2", createdAt: "2026-11-05T10:00:00Z" }];
      onshape.length = 0;
      const next = await checkSystem(system.id, member.id, { force: false });
      expect(next.unchanged).toBe(false);
      expect(onshape).toContainEqual(expect.stringContaining(`assemblies/d/${DID}/v/v2/e/${EID}/bom`));
    });
  });
