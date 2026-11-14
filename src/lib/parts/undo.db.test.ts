// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("undo keeps up stock, overrides and added parts (database): set TEST_DATABASE_URL", () => {});
else
  describe("undo keeps up stock, overrides and added parts (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");
    const { applyPartChanges } = await import("./apply");
    const { applyUndo, planUndo, CREATED } = await import("./undo");
    const { redoBatch } = await import("@/lib/actions/revert");

    const tag = randomUUID().slice(0, 8);
    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Undo Stock" }).returning();
    const otherId = randomUUID();
    const [other] = await db.insert(schema.members).values({ userId: otherId, email: `${otherId}@t.org`, name: "Someone Else" }).returning();
    // A plain COTS category, so the item isn't read as sheet stock.
    const [cat] = await db.insert(schema.inventoryCategories).values({ id: `undo-${tag}`, label: `Undo ${tag}`, group: "cots" }).returning();
    const [item] = await db.insert(schema.inventoryItems).values({ name: `Bearing ${tag}`, category: cat.id }).returning();
    const [robot] = await db.insert(schema.robots).values({ name: `Undo stock bot ${tag}`, year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Intake" }).returning();
    const [cots] = await db
      .insert(schema.parts)
      .values({ systemId: system.id, onshapeName: `Bearing ${tag}`, classification: "cots", inventoryItemId: item.id, quantity: 3, designState: "In Route" })
      .returning();
    const [plate] = await db.insert(schema.parts).values({ systemId: system.id, onshapeName: "Plate", classification: "inhouse", material: "3mm 6061" }).returning();
    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id));
      await db.delete(schema.inventoryCategories).where(eq(schema.inventoryCategories.id, cat.id));
      await db.delete(schema.deletedRecords).where(eq(schema.deletedRecords.deletedBy, member.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
      await db.delete(schema.members).where(eq(schema.members.id, other.id));
    });

    const part = async (id: string) => (await db.select().from(schema.parts).where(eq(schema.parts.id, id)))[0];
    const stock = async () => (await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id)))[0].inStock;
    const undo = async (batchId: string) => {
      const plan = (await planUndo(batchId))!;
      return applyUndo(plan.reverts, member.id, "ui", plan.batches);
    };

    it("takes an arrived order back off the shelf, and redo puts it back", async () => {
      const { batchId } = await applyPartChanges([cots.id], { status: "In Stock" }, { memberId: member.id, via: "ui" });
      expect(await stock()).toBe(3);
      expect((await part(cots.id)).cotsInStockAt).toBeTruthy();

      const undoBatch = await undo(batchId);
      expect((await part(cots.id)).designState).toBe("In Route");
      expect((await part(cots.id)).cotsInStockAt).toBeNull(); // apply.ts's side effects run on undo too
      expect(await stock()).toBe(0);

      await undo(undoBatch);
      expect((await part(cots.id)).designState).toBe("In Stock");
      expect(await stock()).toBe(3);
    });

    it("leaves the stock alone when the status was changed again since", async () => {
      await db.update(schema.parts).set({ designState: "In Route" }).where(eq(schema.parts.id, cots.id));
      await db.update(schema.inventoryItems).set({ inStock: 0 }).where(eq(schema.inventoryItems.id, item.id));
      const { batchId } = await applyPartChanges([cots.id], { status: "In Stock" }, { memberId: member.id, via: "ui" });
      await applyPartChanges([cots.id], { status: "Seen" }, { memberId: member.id, via: "ui" });
      const before = await stock();
      await undo(batchId);
      expect((await part(cots.id)).designState).toBe("Seen");
      expect(await stock()).toBe(before);
    });

    it("gives an undone edit's field back to Onshape's sync", async () => {
      const { batchId } = await applyPartChanges([plate.id], { material: "6mm 6061" }, { memberId: member.id, via: "ui" });
      expect((await part(plate.id)).overriddenFields).toEqual(["material"]);
      await undo(batchId);
      const p = await part(plate.id);
      expect(p.material).toBe("3mm 6061");
      expect(p.overriddenFields).toEqual([]);
    });

    it("moves a part added by hand to Recently deleted", async () => {
      const [manual] = await db.insert(schema.parts).values({ systemId: system.id, isManual: true, displayName: `Bracket ${tag}` }).returning();
      const batchId = randomUUID();
      await db.insert(schema.partHistory).values({ partId: manual.id, field: CREATED, oldValue: null, newValue: manual.displayName, memberId: member.id, via: "ui", batchId });
      await undo(batchId);
      expect(await part(manual.id)).toBeUndefined();
      const trash = await db.select().from(schema.deletedRecords).where(and(eq(schema.deletedRecords.deletedBy, member.id), eq(schema.deletedRecords.label, `Bracket ${tag}`)));
      expect(trash).toHaveLength(1);
    });

    it("redoes only the member's own batch", async () => {
      const { batchId } = await applyPartChanges([plate.id], { note: "deburr" }, { memberId: member.id, via: "ui" });
      const undoBatch = await undo(batchId);
      expect((await redoBatch(undoBatch, other.id)).message).toBe("Nothing to redo.");
      expect((await part(plate.id)).note).toBeNull();
      expect((await redoBatch(undoBatch, member.id)).message).toMatch(/^Redid Note/);
      expect((await part(plate.id)).note).toBe("deburr");
    });
  });
