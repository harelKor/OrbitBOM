// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("COTS order history (database): set TEST_DATABASE_URL", () => {});
else
  describe("COTS order history (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq, asc } = await import("drizzle-orm");
    const { applyPartChanges } = await import("./apply");
    const h = schema.cotsOrderHistory;

    const tag = randomUUID().slice(0, 8);
    const [item] = await db.insert(schema.inventoryItems).values({ name: `Gear ${tag}` }).returning();
    const [part] = await db
      .insert(schema.parts)
      .values({ systemId: null, isManual: true, displayName: `Gear ${tag}`, classification: "cots", inventoryItemId: item.id, quantity: 3, unitPrice: 4, cotsLinks: [{ url: "https://www.wcproducts.com/gear" }], designState: "In Order List" })
      .returning();
    afterAll(async () => {
      await db.delete(schema.parts).where(eq(schema.parts.id, part.id));
      await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id));
    });

    const go = (status: string) => applyPartChanges([part.id], { status }, { memberId: null, via: "mcp", receive: false });
    const cards = () => db.select().from(h).where(eq(h.partId, part.id)).orderBy(asc(h.createdAt));
    const ageAll = () => db.update(h).set({ inRouteAt: new Date(Date.now() - 2 * 86400e3), arrivedAt: null }).where(eq(h.partId, part.id));

    it("opens a card on In Route and takes it back within a day", async () => {
      await go("In Route");
      const [c] = await cards();
      expect(c).toMatchObject({ quantity: 3, unitPrice: 4, vendor: "wcproducts.com", productUrl: "https://www.wcproducts.com/gear", arrivedAt: null, inventoryItemId: item.id });
      expect(c.inRouteAt).toBeTruthy();
      await go("Seen");
      expect(await cards()).toHaveLength(0);
    });

    it("keeps a day-old card and starts a new one next time", async () => {
      await go("In Route");
      await ageAll();
      await go("Seen");
      expect(await cards()).toHaveLength(1);
      await go("In Route");
      expect(await cards()).toHaveLength(2);
    });

    it("dates the arrival on In Stock, and undoes it within a day", async () => {
      await go("In Stock");
      const all = await cards();
      expect(all.filter((c) => c.arrivedAt)).toHaveLength(1);
      expect(all.at(-1)!.arrivedAt).toBeTruthy();
      await go("In Route");
      expect((await cards()).filter((c) => c.arrivedAt)).toHaveLength(0);
      expect(await cards()).toHaveLength(2);
      // Back to the list within a day of going In Route: the newest card goes.
      await go("Seen");
      expect(await cards()).toHaveLength(1);
    });

    it("records a jump straight to In Stock without an In Route date, and removes it within a day", async () => {
      await db.delete(h).where(eq(h.partId, part.id));
      await go("In Stock");
      const [c] = await cards();
      expect(c.inRouteAt).toBeNull();
      expect(c.arrivedAt).toBeTruthy();
      await go("Seen");
      expect(await cards()).toHaveLength(0);
    });

    it("leaves an arrival older than a day alone", async () => {
      await go("In Stock");
      await db.update(h).set({ arrivedAt: new Date(Date.now() - 2 * 86400e3) }).where(eq(h.partId, part.id));
      await go("Seen");
      expect(await cards()).toHaveLength(1);
      await go("In Stock");
      expect(await cards()).toHaveLength(2);
    });

    // Harel, 2026-11-20: the card takes the order pages' name: its own there, else the item's.
    it("names the card as the order pages do", async () => {
      await db.delete(h).where(eq(h.partId, part.id));
      await db.update(schema.parts).set({ displayName: `Gear part ${tag}`, designState: "In Order List" }).where(eq(schema.parts.id, part.id));
      await go("In Route");
      expect((await cards())[0].name).toBe(`Gear ${tag}`);
      await db.delete(h).where(eq(h.partId, part.id));
      await db.update(schema.parts).set({ orderName: "Gears, 20 pack", designState: "In Order List" }).where(eq(schema.parts.id, part.id));
      await go("In Route");
      expect((await cards())[0].name).toBe("Gears, 20 pack");
    });

    // Harel, 2026-11-20: a part bought as its Process 1 records its order too, with no item.
    it("records a part bought as its Process 1", async () => {
      const [bought] = await db
        .insert(schema.parts)
        .values({ systemId: null, isManual: true, displayName: `Bracket ${tag}`, classification: "inhouse", process1: "cots", addedProcesses: [{ machine: "cnc", done: 0, qa: false }], quantity: 2, designState: "In Order List" })
        .returning();
      try {
        const set = (status: string) => applyPartChanges([bought.id], { status }, { memberId: null, via: "mcp" });
        const mine = () => db.select().from(h).where(eq(h.partId, bought.id));
        await set("In Route");
        expect(await mine()).toMatchObject([{ name: `Bracket ${tag}`, quantity: 2, inventoryItemId: null, arrivedAt: null }]);
        await set("In Stock");
        const [card] = await mine();
        expect(card.arrivedAt).toBeTruthy();
        // In Stock on the Order List, Ready for QA in the BOM: bought, nothing counted at the CNC yet.
        const [after] = await db.select().from(schema.parts).where(eq(schema.parts.id, bought.id));
        expect(after).toMatchObject({ designState: null, doneProcess1: 2 });
      } finally {
        await db.delete(h).where(eq(h.partId, bought.id));
        await db.delete(schema.parts).where(eq(schema.parts.id, bought.id));
      }
    });
  });
