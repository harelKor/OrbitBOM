// Runs against a real Postgres when TEST_DATABASE_URL is set. R2 is replaced by a fake.
import { randomUUID } from "node:crypto";
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
    getObject: async (key: string) => (bucket.has(key) ? new Response(bucket.get(key) as Uint8Array<ArrayBuffer>) : null),
    listObjects: async () => [...bucket].map(([key, b]) => ({ key, bytes: b.byteLength, modified: new Date() })),
    deleteObject: async (key: string) => {
      bucket.delete(key);
      await recordDeleted(key);
    },
    presignDownload: async (key: string) => `https://r2.test/${key}`,
  };
});

if (!url) describe.skip("restore from backup (database): set TEST_DATABASE_URL", () => {});
else
  describe("restore from backup (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq, like } = await import("drizzle-orm");
    const { saveNightlyBackup } = await import("./backup");
    const { restoreBackup } = await import("./restore");

    const tag = randomUUID().slice(0, 8);
    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Restore Tester" }).returning();
    const [robot] = await db.insert(schema.robots).values({ name: `Restore bot ${tag}`, year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Intake" }).returning();
    const [location] = await db.insert(schema.inventoryLocations).values({ name: `Shelf ${tag}` }).returning();
    const [item] = await db
      .insert(schema.inventoryItems)
      .values({ name: `Bearing ${tag}`, category: "bearings", inStock: 10, locationId: location.id })
      .returning();
    const [kept] = await db
      .insert(schema.parts)
      .values({ systemId: system.id, onshapeName: `Plate ${tag}`, quantity: 2, inventoryItemId: item.id, lastModifiedBy: member.id })
      .returning();
    const [gone] = await db.insert(schema.parts).values({ systemId: system.id, onshapeName: `Spacer ${tag}` }).returning();
    await db.insert(schema.partHistory).values({ partId: kept.id, field: "note", oldValue: null, newValue: "deburr", via: "ui", batchId: randomUUID() });

    const saved = await saveNightlyBackup();
    const backupKey = (saved as { key: string }).key;

    afterAll(async () => {
      await db.delete(schema.storedFiles).where(like(schema.storedFiles.key, "backups/%"));
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.inventoryItems).where(like(schema.inventoryItems.name, `%${tag}%`));
      await db.delete(schema.inventoryLocations).where(like(schema.inventoryLocations.name, `%${tag}%`));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("puts the inventory back and leaves the BOM alone", async () => {
      await db.update(schema.inventoryItems).set({ name: `Renamed ${tag}`, inStock: 3 }).where(eq(schema.inventoryItems.id, item.id));
      const [added] = await db.insert(schema.inventoryItems).values({ name: `New ${tag}`, category: "gears" }).returning();
      await db.update(schema.parts).set({ note: "changed after" }).where(eq(schema.parts.id, kept.id));
      // The member who last edited the part left: the restored part keeps no link to them.
      await db.delete(schema.members).where(eq(schema.members.id, member.id));

      const r = await restoreBackup(backupKey, ["inventory"]);
      expect(r.safetyCopy).toMatch(/before-restore-\d{4}\.json\.gz$/);
      const [back] = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id));
      expect(back).toMatchObject({ name: `Bearing ${tag}`, inStock: 10, locationId: location.id });
      expect(await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, added.id))).toHaveLength(0);
      const [part] = await db.select().from(schema.parts).where(eq(schema.parts.id, kept.id));
      expect(part.note).toBe("changed after");
    });

    it("puts the BOM back, keeping the history of parts that were in the backup", async () => {
      await db.delete(schema.parts).where(eq(schema.parts.id, gone.id));
      const [extra] = await db.insert(schema.parts).values({ systemId: system.id, onshapeName: `Extra ${tag}` }).returning();

      await restoreBackup(backupKey, ["bom"]);
      const parts = await db.select().from(schema.parts).where(eq(schema.parts.systemId, system.id));
      expect(parts.map((p) => p.onshapeName).sort()).toEqual([`Plate ${tag}`, `Spacer ${tag}`]);
      expect(parts.find((p) => p.id === extra.id)).toBeUndefined();
      const plate = parts.find((p) => p.id === kept.id)!;
      expect(plate).toMatchObject({ note: null, inventoryItemId: item.id, lastModifiedBy: null });
      expect(plate.createdAt).toBeInstanceOf(Date);
      expect(await db.select().from(schema.partHistory).where(eq(schema.partHistory.partId, kept.id))).toHaveLength(1);
    });
  });
