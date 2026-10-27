// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/visits", () => ({ currentVisit: async () => null }));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("Inventory (database): set TEST_DATABASE_URL", () => {});
else
  describe("Inventory (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { applyPartChanges } = await import("@/lib/parts/apply");
    const { moveStock } = await import("./moves");
    const { robotInventory, shelfOfParts, usageOf } = await import("@/lib/data/inventory");

    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Stocker" }).returning();
    const [r1, r2] = await db.insert(schema.robots).values([{ name: "Comp bot", year: 2027 }, { name: "Practice bot", year: 2027 }]).returning();
    const [s1, s2] = await db.insert(schema.systems).values([{ robotId: r1.id, name: "Drive" }, { robotId: r2.id, name: "Drive" }]).returning();
    const [item] = await db.insert(schema.inventoryItems).values({ name: "608 Bearing", inStock: 6 }).returning();
    const [sheet] = await db.insert(schema.inventoryItems).values({ name: "3mm 6061 plate", category: "aluminum-plates", inStock: 1 }).returning();
    const [a, b, loose] = await db
      .insert(schema.parts)
      .values([
        { systemId: s1.id, onshapeName: "608 bearing", classification: "cots" as const, quantity: 8, designState: "In Order List", inventoryItemId: item.id },
        { systemId: s2.id, onshapeName: "608 bearing", classification: "cots" as const, quantity: 8, designState: "Released", inventoryItemId: item.id },
        { systemId: s1.id, onshapeName: "608-Bearing", classification: "cots" as const, sourceDid: "d", sourceEid: "e", onshapePartId: "p" },
      ])
      .returning();
    const ctx = { memberId: member.id, via: "ui" as const };
    const stock = async (id = item.id) => (await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, id)))[0].inStock;

    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, r1.id));
      await db.delete(schema.robots).where(eq(schema.robots.id, r2.id));
      await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id));
      await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.id, sheet.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("shares the shelf between the robots", async () => {
      const u = (await usageOf([item.id])).usage.get(item.id)!;
      expect(u).toMatchObject({ need: 16, covered: 6, short: 10 });
      // The part being ordered is filled before the Released one.
      expect(u.coveredOf.get(a.id)).toBe(6);
      expect(u.coveredOf.get(b.id)).toBe(0);
      const mine = await robotInventory(r2.id);
      expect(mine[0]).toMatchObject({ needed: 8, covered: 0, needAll: 16 });
    });

    it("adds what was missing when an ordered part arrives", async () => {
      await applyPartChanges([a.id], { status: "In Stock" }, ctx);
      expect(await stock()).toBe(8);
      const moves = await db.select().from(schema.inventoryMoves).where(eq(schema.inventoryMoves.itemId, item.id));
      expect(moves).toMatchObject([{ delta: 2, reason: "received", partId: a.id }]);
      // A Released part set In Stock by hand adds nothing.
      await applyPartChanges([b.id], { status: "In Stock" }, ctx);
      expect(await stock()).toBe(8);
    });

    it("never goes below zero and snaps sheet pieces", async () => {
      const moved = await db.transaction((tx) => moveStock(tx, { itemId: item.id, delta: -20, reason: "used" }, ctx));
      expect(moved).toMatchObject({ from: 8, to: 0 });
      await db.transaction((tx) => moveStock(tx, { itemId: sheet.id, delta: 1 / 3, reason: "received" }, ctx));
      await db.transaction((tx) => moveStock(tx, { itemId: sheet.id, delta: 2 / 3, reason: "received" }, ctx));
      expect(await stock(sheet.id)).toBe(2);
    });

    it("suggests the item for an unlinked part, and remembers the link", async () => {
      const [row] = await db.select().from(schema.parts).where(eq(schema.parts.id, loose.id));
      const { suggestion } = await shelfOfParts([row]);
      expect(suggestion.get(loose.id)).toMatchObject({ itemId: item.id, reason: "name" });
      await applyPartChanges([loose.id], { inventoryItemId: item.id }, ctx);
      const [after] = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id));
      expect(after.onshapeKey).toBe("d:e:p");
      expect(after.aliases).toEqual([]);
    });

    it("suggests links into To Review, links on Approve, and offers a rejected one again only as a fallback", async () => {
      const { autoLink } = await import("./autolink");
      const { listRobotReviews, approveReviews, rejectReviews } = await import("@/lib/review/review");
      const [kraken] = await db.insert(schema.inventoryItems).values({ name: "Zorbex Q7 gearbox", cotsLinks: [{ url: "https://wcproducts.com/products/zorbex-q7" }] }).returning();
      const [motor] = await db
        .insert(schema.parts)
        .values({ systemId: s1.id, onshapeName: "Motor", classification: "cots" as const, cotsLinks: [{ url: "http://www.wcproducts.com/products/zorbex-q7/" }] })
        .returning();
      // Not set up at all, only the name.
      const [loose2] = await db.insert(schema.parts).values({ systemId: s1.id, onshapeName: "Zorbex Q7 gearbox v2", classification: "undefined" as const }).returning();
      const itemOf = async (id: string) => (await db.select().from(schema.parts).where(eq(schema.parts.id, id)))[0].inventoryItemId;

      expect(await autoLink({ itemIds: [kraken.id] }, ctx)).toBe(2);
      expect(await itemOf(motor.id)).toBeNull();
      const review = (await listRobotReviews(r1.id)).find((r) => r.partId === motor.id);
      expect(review).toMatchObject({ source: "rule", changes: {}, pending: { inventoryItemId: kraken.id } });
      // Already waiting: not suggested twice.
      expect(await autoLink({ itemIds: [kraken.id] }, ctx)).toBe(0);

      await approveReviews([motor.id], member.id);
      expect(await itemOf(motor.id)).toBe(kraken.id);

      await rejectReviews([loose2.id], member.id);
      expect(await itemOf(loose2.id)).toBeNull();
      // A sync doesn't bring the rejected link back...
      expect(await autoLink({ partIds: [loose2.id] }, ctx)).toBe(0);
      // ...but a run for the item, which has no other match, offers it again.
      expect(await autoLink({ itemIds: [kraken.id] }, ctx)).toBe(1);
      expect((await listRobotReviews(r1.id)).find((r) => r.partId === loose2.id)?.reason).toContain("rejected before");
      await db.delete(schema.parts).where(eq(schema.parts.id, loose2.id));
      await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.id, kraken.id));
    });
    it("keeps a restock card out of the robots' need and puts its whole order on the shelf", async () => {
      const [screw] = await db.insert(schema.inventoryItems).values({ name: "Restock test item", inStock: 1, seasonNeed: 5 }).returning();
      const [card] = await db
        .insert(schema.parts)
        .values({ systemId: null, robotId: null, isManual: true, displayName: screw.name, classification: "cots" as const, inventoryItemId: screw.id, quantity: 4, restock: true, designState: "In Order List" })
        .returning();
      expect((await usageOf([screw.id])).usage.get(screw.id)).toBeUndefined();
      await applyPartChanges([card.id], { status: "In Stock" }, ctx);
      expect(await stock(screw.id)).toBe(5);
      await db.delete(schema.parts).where(eq(schema.parts.id, card.id));
      await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.id, screw.id));
    });
  });
