// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/visits", () => ({ currentVisit: async () => null }));
vi.mock("@/lib/storage/r2", () => ({ imageUrl: async () => null }));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("COTS cards and items (database): set TEST_DATABASE_URL", () => {});
else
  describe("COTS cards and items (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq, inArray } = await import("drizzle-orm");
    const { applyPartChanges } = await import("@/lib/parts/apply");
    const { pushItemToCards } = await import("./cotsSync");
    const { usageOf } = await import("@/lib/data/inventory");
    const { listCotsParts } = await import("@/lib/data/parts");

    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Buyer" }).returning();
    const [robot] = await db.insert(schema.robots).values({ name: "Sync bot", year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Intake" }).returning();
    const [item] = await db.insert(schema.inventoryItems).values({ name: "Kraken X60", inStock: 0, price: 200, cotsLinks: [{ url: "https://wcproducts.com/kraken" }] }).returning();
    const cots = { classification: "cots" as const, inventoryItemId: item.id, designState: "Released" };
    const [onshape, general, robotCard] = await db
      .insert(schema.parts)
      .values([
        { ...cots, systemId: system.id, onshapeName: "Kraken X60 (CAD)" },
        { ...cots, systemId: null, isManual: true, displayName: "Kraken X60" },
        { ...cots, systemId: null, robotId: robot.id, isManual: true, displayName: "Kraken X60", quantity: 2 },
      ])
      .returning();
    const ids = [onshape.id, general.id, robotCard.id];
    const ctx = { memberId: member.id, via: "ui" as const };
    const part = async (id: string) => (await db.select().from(schema.parts).where(eq(schema.parts.id, id)))[0];
    const itemNow = async () => (await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id)))[0];

    afterAll(async () => {
      await db.delete(schema.parts).where(inArray(schema.parts.id, ids));
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("lists system-less cards in General and in their robot, and counts them on the shelf", async () => {
      const { parts } = await listCotsParts();
      const mine = parts.filter((p) => ids.includes(p.id));
      expect(mine.find((p) => p.id === general.id)?.robotId).toBeNull();
      expect(mine.find((p) => p.id === robotCard.id)?.robotId).toBe(robot.id);
      expect(mine.find((p) => p.id === onshape.id)?.robotId).toBe(robot.id);
      const { usage } = await usageOf([item.id]);
      expect(usage.get(item.id)?.need).toBe(4);
    });

    it("copies a card's price and links to its item and the item's other cards", async () => {
      await applyPartChanges([general.id], { unitPrice: 190, cotsLinks: [{ url: "https://andymark.com/kraken" }] }, ctx);
      expect((await itemNow()).price).toBe(190);
      for (const id of [onshape.id, robotCard.id]) {
        expect((await part(id)).unitPrice).toBe(190);
        expect((await part(id)).cotsLinks[0].url).toBe("https://andymark.com/kraken");
      }
    });

    it("renames the item and only the manual cards", async () => {
      await applyPartChanges([robotCard.id], { displayName: "Kraken X60 motor" }, ctx);
      expect((await itemNow()).name).toBe("Kraken X60 motor");
      expect((await part(general.id)).displayName).toBe("Kraken X60 motor");
      expect((await part(onshape.id)).displayName).toBeNull();
      await db.transaction((tx) => pushItemToCards(tx, item.id, { name: "Kraken" }));
      expect((await part(general.id)).displayName).toBe("Kraken");
    });

    it("stamps when a card reached In Stock and un-clears it when it leaves", async () => {
      await applyPartChanges([general.id], { status: "In Stock" }, ctx);
      const arrived = (await part(general.id)).cotsInStockAt;
      expect(arrived).not.toBeNull();
      await db.update(schema.parts).set({ cotsClearedAt: new Date() }).where(eq(schema.parts.id, general.id));
      await applyPartChanges([general.id], { stockCount: 1 }, ctx);
      expect((await part(general.id)).cotsInStockAt).toEqual(arrived);
      await applyPartChanges([general.id], { status: "In Route" }, ctx);
      const after = await part(general.id);
      expect(after.cotsInStockAt).toBeNull();
      expect(after.cotsClearedAt).toBeNull();
    });
  });
