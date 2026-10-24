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
    const { loadVersionTags } = await import("./tags");

    const headers = [
      { id: "n", name: "Name" },
      { id: "q", name: "Quantity" },
    ];
    let source = { wvmType: "v", wvmId: "v1" };
    // Each BOM row: partId → [name, quantity]. Shapes: version → partId → volume.
    let bomParts: Record<string, [string, number]> = { A: ["Part A", 2], B: ["Part B", 4] };
    const shapes: Record<string, Record<string, number>> = { v1: { A: 1, B: 2 }, v2: { A: 1.5, B: 2 }, v3: { A9: 1.5, B9: 2 }, v4: { A9: 1.7, B9: 2 } };
    let microversion = "mv1";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      calls.push(input);
      let body: unknown;
      if (input.includes("currentmicroversion")) body = { microversion };
      else if (input.includes("/massproperties")) {
        const version = input.match(/\/v\/(v\d)\//)![1];
        const wanted = [...input.matchAll(/partId=(\w+)/g)].map((m) => m[1]);
        body = { bodies: Object.fromEntries(wanted.map((id) => [id, { volume: [shapes[version][id]], periphery: [6], principalInertia: [1, 2, 3], hasMass: true }])) };
      } else if (input.includes("/versions/")) body = { name: "V2 shorter arm" };
      else
        body = {
          headers,
          rows: Object.entries(bomParts).map(([partId, [n, q]]) => ({
            itemSource: { documentId: CAD, elementId: "studio", partId, ...source },
            headerIdToValue: { n, q },
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
      { ...synced, onshapePartId: "A", onshapeName: "Part A", quantity: 2, designState: "Gcoded" },
      { ...synced, onshapePartId: "B", onshapeName: "Part B", quantity: 4 },
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
      bomParts = { A: ["Part A", 2], B: ["Part B", 6] };
      calls.length = 0;
      const r = await checkSystem(system.id, member.id);
      // The new version's shapes, and the old version's for parts with none stored yet.
      expect(calls.filter((c) => c.includes("massproperties"))).toHaveLength(2);
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
      expect(a).toMatchObject({ sourceWid: "v2", designState: "Gcoded" });
      expect(a.shapeSig).toMatch(/^1\.50000,/);
      expect(b.quantity).toBe(6);

      const rows = await db.select().from(schema.partVersions).where(eq(schema.partVersions.versionId, draft.id));
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.partId === a.id)?.id).toBe(a.versionRowId);
      const history = await db.select().from(schema.partHistory).where(eq(schema.partHistory.batchId, draft.id));
      expect(history.map((h) => [h.field, h.newValue])).toEqual([["quantity", 6]]);
      const [s] = await db.select().from(schema.systems).where(eq(schema.systems.id, system.id));
      expect(s.currentVersionId).toBe(draft.id);
    });

    it("takes the same shapes under new partIds in a newer version without a commit", async () => {
      const before = await live();
      source = { wvmType: "v", wvmId: "v3" };
      bomParts = { B9: ["Part B", 6], A9: ["Part A", 2] };
      microversion = "mv2";
      const r = await checkSystem(system.id, member.id, { force: false });
      expect(r.draft).toBeNull();
      const after = await live();
      expect(after.map((p) => [p.id, p.onshapePartId, p.sourceWid])).toEqual([
        [before[0].id, "A9", "v3"],
        [before[1].id, "B9", "v3"],
      ]);
      const drafts = await db
        .select()
        .from(schema.systemVersions)
        .where(and(eq(schema.systemVersions.systemId, system.id), eq(schema.systemVersions.state, "draft")));
      expect(drafts).toHaveLength(0);
    });

    it("commits one part alone and leaves the rest Outdated until committed", async () => {
      source = { wvmType: "v", wvmId: "v4" };
      bomParts = { A9: ["Part A", 2], B9: ["Part B", 7] };
      microversion = "mv3";
      const { draft } = await checkSystem(system.id, member.id);
      const [a, b] = await live();
      const keyOf = (id: string) => draft!.changes.find((c) => c.partId === id)!.key;

      const one = await commitDraft(system.id, member.id, { draftId: draft!.id, only: keyOf(a.id), name: "Arm plate" });
      expect(one.seq).toBe(2);
      const [a2, b2] = await live();
      expect([a2.shapeSig?.slice(0, 7), b2.quantity]).toEqual(["1.70000", 6]);
      let tags = await loadVersionTags(system.id);
      expect(tags.parts[a.id]).toMatchObject({ seq: 2, name: "Arm plate" });
      expect(Object.keys(tags.outdated)).toEqual([b.id]);
      expect(tags.missed).toMatchObject({ seq: 2 });

      await commitDraft(system.id, member.id, { draftId: draft!.id, only: tags.outdated[b.id] });
      expect((await live())[1].quantity).toBe(7);
      tags = await loadVersionTags(system.id);
      expect(tags.outdated).toEqual({});
      expect(tags.draft).toBeNull();
      expect(tags.parts[b.id]).toMatchObject({ seq: 2 });
      const v2 = (await versions()).find((v) => v.seq === 2)!;
      expect(v2.changes.map((c) => c.name)).toEqual(["Part A", "Part B"]);
    });
  });
