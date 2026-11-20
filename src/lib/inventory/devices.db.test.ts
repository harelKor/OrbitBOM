// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/visits", () => ({ currentVisit: async () => null }));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("Computers & Devices (database): set TEST_DATABASE_URL", () => {});
else
  describe("Computers & Devices (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { asc, eq } = await import("drizzle-orm");
    const { moveStock, setStock } = await import("./moves");
    const { createItem } = await import("./create");
    const { itemDevices } = await import("./devices");
    const { deleteToTrash } = await import("@/lib/trash");

    // Migration 0099 adds the category to a seeded table; make sure it's there either way.
    const made = await db
      .insert(schema.inventoryCategories)
      .values({ id: "computers-devices", label: "Computers & Devices", group: "tools", devices: true })
      .onConflictDoNothing()
      .returning();
    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Devices" }).returning();
    const ctx = { memberId: member.id, via: "ui" as const };
    const itemId = await db.transaction((tx) => createItem(tx, { name: "CNC PC", category: "computers-devices" }, 2, ctx));
    const rows = () => db.select().from(schema.inventoryDevices).where(eq(schema.inventoryDevices.itemId, itemId)).orderBy(asc(schema.inventoryDevices.position));
    const stock = async () => (await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, itemId)))[0]?.inStock;

    afterAll(async () => {
      await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.id, itemId));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
      if (made.length) await db.delete(schema.inventoryCategories).where(eq(schema.inventoryCategories.id, "computers-devices"));
    });

    it("keeps one device per unit of stock, each change a move", async () => {
      expect(await rows()).toHaveLength(2);
      await db.transaction((tx) => moveStock(tx, { itemId, delta: 1, reason: "received" }, ctx));
      const three = await rows();
      expect(three).toHaveLength(3);
      // A new device stands in the middle of the picture.
      expect(three[2]).toMatchObject({ x: 0.5, y: 0.5 });
      // − takes off the one picked, not the newest.
      await db.transaction((tx) => moveStock(tx, { itemId, delta: -1, reason: "counted", deviceId: three[0].id }, ctx));
      expect((await rows()).map((d) => d.id)).toEqual([three[1].id, three[2].id]);
      await db.transaction((tx) => setStock(tx, itemId, 0, ctx));
      expect(await rows()).toHaveLength(0);
      const moves = await db.select().from(schema.inventoryMoves).where(eq(schema.inventoryMoves.itemId, itemId));
      expect(moves.map((m) => m.delta).sort()).toEqual([-1, -2, 1, 2]);
      expect(await stock()).toBe(0);
    });

    it("makes the rows of an item moved into the category", async () => {
      await db.update(schema.inventoryItems).set({ inStock: 2 }).where(eq(schema.inventoryItems.id, itemId));
      expect(await itemDevices(itemId)).toHaveLength(2);
      expect(await rows()).toHaveLength(2);
    });

    it("keeps the devices in Recently deleted", async () => {
      await db.transaction((tx) => deleteToTrash(tx, { kind: "item", label: "CNC PC", root: schema.inventoryItems, where: eq(schema.inventoryItems.id, itemId), memberId: member.id }));
      expect(await rows()).toHaveLength(0);
      const [kept] = await db.select().from(schema.deletedRecords).where(eq(schema.deletedRecords.label, "CNC PC"));
      expect(kept.rows.tables.find((t) => t.table === "inventory_devices")?.rows).toHaveLength(2);
      await db.delete(schema.deletedRecords).where(eq(schema.deletedRecords.id, kept.id));
    });
  });
