// Runs against a real Postgres when TEST_DATABASE_URL is set.
// The reads kept in the server's memory (cache.ts) show a save at once: a part's status change,
// a stock tap, a new inventory group (2026-11-14).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/visits", () => ({ currentVisit: async () => null }));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("cached reads stay fresh (database): set TEST_DATABASE_URL", () => {});
else
  describe("cached reads stay fresh (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { globalSearch } = await import("./search");
    const { listNewest } = await import("./seen");
    const { listInventory } = await import("./inventory");
    const { moveStock } = await import("@/lib/inventory/moves");
    const { listCategories } = await import("./categories");

    const tag = randomUUID().slice(0, 8);
    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Fresh" }).returning();
    const [robot] = await db.insert(schema.robots).values({ name: `Fresh bot ${tag}`, year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Drive" }).returning();
    const [part] = await db.insert(schema.parts).values({ systemId: system.id, onshapeName: `Freshplate ${tag}`, quantity: 1 }).returning();
    const [item] = await db.insert(schema.inventoryItems).values({ name: `Freshbolt ${tag}`, inStock: 3 }).returning();

    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("search shows a status change and a stock tap right away", async () => {
      const before = (await globalSearch(`Freshplate ${tag}`)).bom[0].parts[0].status;
      await db.update(schema.parts).set({ designState: "Released" }).where(eq(schema.parts.id, part.id));
      const after = (await globalSearch(`Freshplate ${tag}`)).bom[0].parts[0].status;
      expect(after).toBe("Released");
      expect(after).not.toBe(before);

      expect((await globalSearch(`Freshbolt ${tag}`)).inventory[0].items[0].inStock).toBe(3);
      const cats = await listCategories();
      await db.transaction((tx) => moveStock(tx, { itemId: item.id, delta: 1, reason: "received" }, { memberId: member.id, via: "ui", cats }));
      expect((await globalSearch(`Freshbolt ${tag}`)).inventory[0].items[0].inStock).toBe(4);
    });

    it("arrivals glow for others as soon as a part arrives, never for who moved it", async () => {
      const page = `fab:${robot.id}`;
      const other = randomUUID();
      const seen = Object.keys(await listNewest(other)).filter((k) => k.includes(robot.id));
      expect(seen).toEqual([]);
      await db.update(schema.parts).set({ designState: "Released", process1: "cnc", stageAt: new Date(), lastModifiedBy: member.id }).where(eq(schema.parts.id, part.id));
      const newest = await listNewest(other);
      expect(Object.keys(newest).some((k) => k.startsWith(page))).toBe(true);
      expect(Object.keys(await listNewest(member.id)).some((k) => k.startsWith(page))).toBe(false);
    });

    it("the shelf shows a new group at once", async () => {
      const name = `Fresh group ${tag}`;
      expect((await listInventory({ itemIds: [item.id] })).groups.some((g) => g.name === name)).toBe(false);
      const [g] = await db.insert(schema.inventoryGroups).values({ name }).returning();
      try {
        expect((await listInventory({ itemIds: [item.id] })).groups.some((x) => x.name === name)).toBe(true);
      } finally {
        await db.delete(schema.inventoryGroups).where(eq(schema.inventoryGroups.id, g.id));
      }
    });
  });
