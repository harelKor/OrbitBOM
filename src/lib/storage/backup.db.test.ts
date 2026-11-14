// Runs against a real Postgres when TEST_DATABASE_URL is set. R2 is replaced by a fake.
import { gunzipSync } from "node:zlib";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;
const bucket = new Map<string, Uint8Array>();

vi.mock("@/lib/storage/r2", async () => {
  const { recordDeleted, recordStored } = await import("./ledger");
  return {
    storageConfigured: () => true,
    putObject: async (key: string, body: Uint8Array) => {
      bucket.set(key, body);
      await recordStored(key, body.byteLength);
    },
    listObjects: async () => [...bucket].map(([key, b]) => ({ key, bytes: b.byteLength, modified: new Date() })),
    deleteObject: async (key: string) => {
      bucket.delete(key);
      await recordDeleted(key);
    },
    presignDownload: async (key: string) => `https://r2.test/${key}`,
  };
});

if (!url) describe.skip("nightly backup (database): set TEST_DATABASE_URL", () => {});
else
  describe("nightly backup (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq, like } = await import("drizzle-orm");
    const { backupInfo, latestBackupUrl, saveNightlyBackup } = await import("./backup");

    const [robot] = await db.insert(schema.robots).values({ name: "Backup bot", year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Intake" }).returning();
    await db.insert(schema.parts).values({ systemId: system.id, onshapeName: "Backup plate" });
    // A backup from long ago that the run should delete.
    bucket.set("backups/orbitparts-2020-01-01.json.gz", new Uint8Array([1]));

    afterAll(async () => {
      await db.delete(schema.storedFiles).where(like(schema.storedFiles.key, "backups/%"));
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
    });

    it("writes today's gzipped JSON with the BOM and inventory, and drops old ones", async () => {
      const r = await saveNightlyBackup();
      const day = new Date().toISOString().slice(0, 10);
      expect(r).toMatchObject({ key: `backups/orbitparts-${day}.json.gz`, deleted: 1 });
      expect(bucket.has("backups/orbitparts-2020-01-01.json.gz")).toBe(false);
      const backup = JSON.parse(gunzipSync(bucket.get(`backups/orbitparts-${day}.json.gz`)!).toString());
      expect(backup.app).toBe("OrbitParts");
      for (const t of ["parts", "partFiles", "groupFiles", "inventoryItems", "inventoryCategories", "inventoryMoves", "materialGroups"]) {
        expect(Array.isArray(backup.tables[t])).toBe(true);
      }
      expect(backup.tables.parts.some((p: { onshapeName: string }) => p.onshapeName === "Backup plate")).toBe(true);
      expect(backup.tables.members).toBeUndefined();
    });

    it("shows in the storage window and can be downloaded", async () => {
      // The server's pg_dump files (counted by the nightly recount) aren't offered for restore.
      await db.insert(schema.storedFiles).values({ key: "backups/sql/daily/orbitparts-2099-01-01.sql.gz", bytes: 5, kind: "backup", createdAt: new Date("2099-01-01") });
      const info = await backupInfo();
      expect(info.all.some((b) => b.key.startsWith("backups/sql/"))).toBe(false);
      expect(info.latest?.key).toMatch(/^backups\/orbitparts-\d{4}-\d{2}-\d{2}\.json\.gz$/);
      expect(await latestBackupUrl()).toBe(`https://r2.test/${info.latest!.key}`);
    });
  });
