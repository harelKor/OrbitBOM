// Runs against a real Postgres when TEST_DATABASE_URL is set (npm run test:db).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("delete version (database): set TEST_DATABASE_URL", () => {});
else
  describe("delete version (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq, inArray } = await import("drizzle-orm");
    const { deleteVersion } = await import("./deleteVersion");
    const { saveSnapshot, loadSnapshot, snapKey } = await import("@/lib/model/snapshotStore");

    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Delete Tester" }).returning();
    const [robot] = await db.insert(schema.robots).values({ name: "Delete bot", year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Arm", assemblyUrl: "https://cad.onshape.com/documents/aaaaaaaaaaaaaaaaaaaaaaaa/w/bbbbbbbbbbbbbbbbbbbbbbbb/e/cccccccccccccccccccccccc" }).returning();
    const [a, b] = await db
      .insert(schema.parts)
      .values([
        { systemId: system.id, sourceDid: "d", sourceEid: "e", onshapePartId: "A", onshapeName: "Plate A" },
        { systemId: system.id, sourceDid: "d", sourceEid: "e", onshapePartId: "B", onshapeName: "Plate B" },
      ])
      .returning();
    const version = async (seq: number) =>
      (await db.insert(schema.systemVersions).values({ systemId: system.id, state: "committed", seq, committedAt: new Date(Date.UTC(2026, 10, seq)) }).returning())[0];
    const v1 = await version(1);
    const v2 = await version(2);
    const v3 = await version(3);
    const row = async (versionId: string, partId: string) => (await db.insert(schema.partVersions).values({ versionId, partId, change: "modified", snapshot: {} as never }).returning())[0];
    await row(v1.id, a.id);
    await row(v1.id, b.id);
    const onlyInV2 = await row(v2.id, a.id); // v3 doesn't change A: its state moves to v3
    await row(v2.id, b.id); // v3 changes B too: v2's B goes
    const bInV3 = await row(v3.id, b.id);
    await db.update(schema.parts).set({ versionRowId: bInV3.id }).where(eq(schema.parts.id, b.id));
    await db.update(schema.parts).set({ versionRowId: onlyInV2.id }).where(eq(schema.parts.id, a.id));
    await db.update(schema.systems).set({ currentVersionId: v3.id }).where(eq(schema.systems.id, system.id));

    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    const node = (bomIds: string[]) => ({ owner: { systemId: system.id }, kind: "final" as const, did: null, vid: null, bomIds, subIds: [], ref: null });

    it("folds a middle BOM version's part states into the next one", async () => {
      await deleteVersion(node([v2.id]), member.id);
      const left = await db.select().from(schema.systemVersions).where(eq(schema.systemVersions.systemId, system.id));
      expect(left.map((v) => v.seq).sort()).toEqual([1, 3]);
      const rows = await db.select().from(schema.partVersions).where(inArray(schema.partVersions.versionId, [v1.id, v3.id]));
      // A's v2 state is now v3's (the part still points at it); v2's B is gone.
      expect(rows.find((r) => r.id === onlyInV2.id)?.versionId).toBe(v3.id);
      expect(rows.filter((r) => r.partId === b.id).map((r) => r.versionId).sort()).toEqual([v1.id, v3.id].sort());
    });

    it("refuses to take a state a part stands on", async () => {
      // v1's B is replaced by v3's; point B back at v1's to stand on it.
      const [v1b] = await db.select().from(schema.partVersions).where(eq(schema.partVersions.versionId, v1.id)).then((r) => r.filter((x) => x.partId === b.id));
      await db.update(schema.parts).set({ versionRowId: v1b.id }).where(eq(schema.parts.id, b.id));
      await expect(deleteVersion(node([v1.id]), member.id)).rejects.toThrow(/Update/);
      await db.update(schema.parts).set({ versionRowId: bInV3.id }).where(eq(schema.parts.id, b.id));
    });

    it("keeps the only version, and drops a deleted Onshape version from the tree with its snapshot", async () => {
      const ref = { wvm: "v" as const, wvmid: "dddddddddddddddddddddddd" };
      const src = { did: "aaaaaaaaaaaaaaaaaaaaaaaa", eid: "cccccccccccccccccccccccc", wvm: "v", wvmid: ref.wvmid };
      await saveSnapshot(robot.id, "final", src, { jobs: [{ key: "f" }], placements: [], names: {} });
      expect(await loadSnapshot(snapKey("final", src, ref))).not.toBeNull();
      await deleteVersion({ ...node([]), did: src.did, vid: ref.wvmid, ref }, member.id);
      expect(await loadSnapshot(snapKey("final", src, ref))).toBeNull();
      const hidden = await db.select().from(schema.deletedVersions).where(eq(schema.deletedVersions.versionId, ref.wvmid));
      expect(hidden).toHaveLength(1);
      await db.delete(schema.deletedVersions).where(eq(schema.deletedVersions.versionId, ref.wvmid));

      await deleteVersion(node([v1.id]), member.id); // v1's A state was replaced by none: moves to v3
      await expect(deleteVersion(node([v3.id]), member.id)).rejects.toThrow(/only BOM version/);
    });
  });
