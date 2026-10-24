// Runs against a real Postgres when TEST_DATABASE_URL is set. R2 is replaced by a fake.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;
const bucket = new Map<string, number>();
const MB = 1024 ** 2;

vi.mock("@/lib/storage/r2", async () => {
  const { recordDeleted } = await import("./ledger");
  return {
    storageConfigured: () => true,
    listObjects: async () => [...bucket].map(([key, bytes]) => ({ key, bytes, modified: new Date("2026-01-01") })),
    deleteObject: async (key: string) => {
      bucket.delete(key);
      await recordDeleted(key);
    },
  };
});

if (!url) describe.skip("storage (database): set TEST_DATABASE_URL", () => {});
else
  describe("storage (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq, inArray } = await import("drizzle-orm");
    const { cleanUpStorage, deleteVersionPreviews, recountStorage, storageUsage } = await import("./usage");
    const { partModelFile } = await import("@/lib/model/part");

    const [robot] = await db.insert(schema.robots).values({ name: "Storage bot", year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Intake" }).returning();
    const [part] = await db.insert(schema.parts).values({ systemId: system.id, onshapeName: "Roller", thumbnailRev: "r2" }).returning();
    // Five versions; the part is on v1, v2 is named, v3–v5 are the newest three.
    const versions = await db
      .insert(schema.systemVersions)
      .values([1, 2, 3, 4, 5].map((seq) => ({ systemId: system.id, state: "committed" as const, seq, name: seq === 2 ? "Before comp" : null, committedAt: new Date(2026, 0, seq) })))
      .returning();
    const v = (seq: number) => versions.find((x) => x.seq === seq)!;
    const [row] = await db.insert(schema.partVersions).values({ versionId: v(1).id, partId: part.id, change: "baseline", snapshot: {} as never }).returning();
    await db.update(schema.parts).set({ versionRowId: row.id }).where(eq(schema.parts.id, part.id));

    const tag = randomUUID().slice(0, 8);
    const old = `models/parts/${part.id}/old-${tag}.bin.gz`;
    const current = partModelFile(part);
    const preview = (seq: number) => `models/previews/${tag}-${seq}.bin.gz`;
    for (const [key, bytes] of [[old, 3 * MB], [current, 1 * MB], ...[1, 2, 3, 4, 5].map((s) => [preview(s), 2 * MB] as const)] as const) bucket.set(key, bytes);
    const keys = [...bucket.keys()];

    afterAll(async () => {
      await db.delete(schema.storedFiles).where(inArray(schema.storedFiles.key, keys));
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
    });

    it("recounts the bucket into the ledger and sums it per version", async () => {
      await recountStorage();
      for (const s of [1, 2, 3, 4, 5]) await db.update(schema.storedFiles).set({ versionId: v(s).id }).where(eq(schema.storedFiles.key, preview(s)));
      const usage = await storageUsage();
      expect(usage.total).toBeGreaterThanOrEqual(14 * MB);
      const intake = usage.systems.find((s) => s.id === system.id)!;
      expect(intake.bytes).toBe(10 * MB);
      expect(intake.versions.map((x) => [x.label, x.protected])).toEqual([
        ["#5", true],
        ["#4", true],
        ["#3", true],
        ["#2", true],
        ["#1", true],
      ]);
    });

    it("cleans up unused part files, then unprotected previews, oldest first", async () => {
      await db.update(schema.systemVersions).set({ name: null }).where(eq(schema.systemVersions.id, v(2).id));
      await db.update(schema.storedFiles).set({ createdAt: new Date("2026-01-01") }).where(inArray(schema.storedFiles.key, keys));
      const usage = await storageUsage();
      const r = await cleanUpStorage({ force: true, target: usage.total - 4 * MB });
      expect(r).toEqual({ freed: 5 * MB, files: 2 });
      expect(bucket.has(old)).toBe(false);
      expect(bucket.has(preview(2))).toBe(false);
      expect(bucket.has(current)).toBe(true);
      expect(bucket.has(preview(1))).toBe(true); // the part is on v1
    });

    it("deletes one version's previews", async () => {
      const r = await deleteVersionPreviews(v(5).id);
      expect(r).toEqual({ freed: 2 * MB, files: 1 });
      expect(bucket.has(preview(5))).toBe(false);
    });
  });
