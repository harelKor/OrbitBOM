// Runs against a real Postgres when TEST_DATABASE_URL is set. Onshape is replaced by a fake fetch.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

const DID = "2123456789abcdef01234567";
const WID = "a9abcdef0123456789abcdef";
const EID = "bedcba9876543210fedcba98";
const CAD = "3123456789abcdef01234567"; // the CAD document the Manufacture assembly inserts

if (!url) describe.skip("system versions (database): set TEST_DATABASE_URL", () => {});
else
  describe("system versions (database)", async () => {
    process.env.DATABASE_URL = url;
    process.env.ONSHAPE_TOKEN_KEY = randomBytes(32).toString("base64");
    const { db, schema } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");
    const { encrypt } = await import("@/lib/crypto");
    const { checkSystem } = await import("./detect");
    const { commitDraft, VersionError } = await import("./commit");

    const headers = [
      { id: "n", name: "Name" },
      { id: "q", name: "Quantity" },
    ];
    let source = { wvmType: "v", wvmId: "v1" };
    let qty = { A: 2, B: 4 };
    let partMvs = { A: "pmA1", B: "pmB1" };
    let microversion = "mv1";
    vi.stubGlobal("fetch", async (input: string) => {
      let body: unknown;
      if (input.includes("currentmicroversion")) body = { microversion };
      else if (input.includes("/parts/d/")) body = Object.entries(partMvs).map(([partId, microversionId]) => ({ partId, microversionId }));
      else if (input.includes("/versions/")) body = { name: "V2 shorter arm" };
      else
        body = {
          headers,
          rows: Object.entries(qty).map(([partId, q]) => ({
            itemSource: { documentId: CAD, elementId: "studio", partId, ...source },
            headerIdToValue: { n: `Part ${partId}`, q },
          })),
        };
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const userId = randomUUID();
    const [member] = await db
      .insert(schema.members)
      .values({ userId, email: `${userId}@t.org`, name: "Version Tester", onshapeConnected: true })
      .returning();
    await db.insert(schema.onshapeTokens).values({
      memberId: member.id,
      accessTokenEnc: encrypt("access"),
      refreshTokenEnc: encrypt("refresh"),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const [robot] = await db.insert(schema.robots).values({ name: "Version bot", year: 2027 }).returning();
    const [system] = await db
      .insert(schema.systems)
      .values({ robotId: robot.id, name: "Arm", assemblyUrl: `https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}` })
      .returning();
    // Parts synced before versioning existed.
    const synced = { systemId: system.id, sourceDid: CAD, sourceWvm: "v", sourceWid: "v1", sourceEid: "studio" };
    await db.insert(schema.parts).values([
      { ...synced, onshapePartId: "A", onshapeName: "Part A", quantity: 2, onshapeMv: "pmA1", designState: "Gcoded" },
      { ...synced, onshapePartId: "B", onshapeName: "Part B", quantity: 4, onshapeMv: "pmB1" },
    ]);

    const live = async () =>
      (await db.select().from(schema.parts).where(eq(schema.parts.systemId, system.id))).sort((a, b) =>
        (a.onshapeName ?? "").localeCompare(b.onshapeName ?? ""),
      );
    const versions = () => db.select().from(schema.systemVersions).where(eq(schema.systemVersions.systemId, system.id));

    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("finds a changed shape and a changed property without touching the BOM", async () => {
      source = { wvmType: "v", wvmId: "v2" };
      partMvs = { A: "pmA2", B: "pmB1" };
      qty = { A: 2, B: 6 };
      const r = await checkSystem(system.id, member.id);
      expect(r.draft?.name).toBe("V2 shorter arm");
      expect(r.draft?.changes.map((c) => [c.name, c.change, c.geometry, Object.keys(c.fields)])).toEqual([
        ["Part A", "modified", true, []],
        ["Part B", "modified", false, ["quantity"]],
      ]);
      const [a, b] = await live();
      expect([a.sourceWid, b.quantity]).toEqual(["v1", 4]);
    });

    it("keeps the draft (and its time) when a check finds the same list", async () => {
      const [before] = await versions();
      const r = await checkSystem(system.id, member.id);
      expect(r.draft?.id).toBe(before.id);
      expect(r.draft?.detectedAt.toISOString()).toBe(before.detectedAt.toISOString());
    });

    it("won't commit a list the member didn't see", async () => {
      const [draft] = await versions();
      await expect(commitDraft(system.id, member.id, { draftId: draft.id, seen: new Date(0).toISOString() })).rejects.toBeInstanceOf(VersionError);
    });

    it("commits the draft as version 1 over a baseline", async () => {
      const [draft] = await versions();
      const c = await commitDraft(system.id, member.id, { draftId: draft.id, seen: draft.detectedAt.toISOString(), name: "Shorter arm" });
      expect(c.seq).toBe(1);

      const all = (await versions()).sort((x, y) => x.seq! - y.seq!);
      expect(all.map((v) => [v.seq, v.state, v.name])).toEqual([
        [0, "committed", "Baseline"],
        [1, "committed", "Shorter arm"],
      ]);
      const [a, b] = await live();
      expect(a).toMatchObject({ sourceWid: "v2", onshapeMv: "pmA2", designState: "Gcoded" });
      expect(b.quantity).toBe(6);

      const rows = await db.select().from(schema.partVersions).where(eq(schema.partVersions.versionId, draft.id));
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.partId === a.id)?.id).toBe(a.versionRowId);
      const history = await db.select().from(schema.partHistory).where(eq(schema.partHistory.batchId, draft.id));
      expect(history.map((h) => [h.field, h.newValue])).toEqual([["quantity", 6]]);
      const [s] = await db.select().from(schema.systems).where(eq(schema.systems.id, system.id));
      expect(s.currentVersionId).toBe(draft.id);
    });

    it("takes the same parts in a newer subassembly version without a commit", async () => {
      source = { wvmType: "v", wvmId: "v3" };
      microversion = "mv2";
      const r = await checkSystem(system.id, member.id, { force: false });
      expect(r.draft).toBeNull();
      expect((await live()).map((p) => p.sourceWid)).toEqual(["v3", "v3"]);
      const drafts = await db
        .select()
        .from(schema.systemVersions)
        .where(and(eq(schema.systemVersions.systemId, system.id), eq(schema.systemVersions.state, "draft")));
      expect(drafts).toHaveLength(0);
    });
  });
