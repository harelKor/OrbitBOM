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
  });
