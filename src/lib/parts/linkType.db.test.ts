// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("linking an item sets the part type (database): set TEST_DATABASE_URL", () => {});
else
  describe("linking an item sets the part type (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq, inArray } = await import("drizzle-orm");
    const { applyPartChanges } = await import("./apply");

    const tag = randomUUID().slice(0, 8);
    const cats = [
      { id: `raw-${tag}`, label: "Raw", group: "consumables" },
      { id: `cots-${tag}`, label: "Gears", group: "cots" },
    ];
    await db.insert(schema.inventoryCategories).values(cats);
    const [plate, gear] = await db
      .insert(schema.inventoryItems)
      .values([
        { name: `3mm plate ${tag}`, category: cats[0].id },
        { name: `Gear ${tag}`, category: cats[1].id },
      ])
      .returning();
    const [robot] = await db.insert(schema.robots).values({ name: "Link bot", year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Arm" }).returning();
    const [a, b, c] = await db
      .insert(schema.parts)
      .values([
        { systemId: system.id, onshapeName: "A", classification: "cots" },
        { systemId: system.id, onshapeName: "B", classification: "undefined" },
        { systemId: system.id, onshapeName: "C", classification: "inhouse" },
      ])
      .returning();

    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.inventoryItems).where(inArray(schema.inventoryItems.id, [plate.id, gear.id]));
      await db.delete(schema.inventoryCategories).where(inArray(schema.inventoryCategories.id, cats.map((x) => x.id)));
    });

    it("makes a part linked to Raw Stock in-house and one linked to a COTS item COTS", async () => {
      await applyPartChanges([a.id], { inventoryItemId: plate.id }, { memberId: null, via: "ui" });
      await applyPartChanges([b.id], { inventoryItemId: gear.id }, { memberId: null, via: "ui" });
      await applyPartChanges([c.id], { inventoryItemId: gear.id, classification: "inhouse" }, { memberId: null, via: "ui" });
      const rows = await db.select().from(schema.parts).where(eq(schema.parts.systemId, system.id));
      const by = new Map(rows.map((r) => [r.onshapeName, r]));
      expect(by.get("A")).toMatchObject({ classification: "inhouse", material: plate.name, inventoryItemId: plate.id });
      expect(by.get("B")).toMatchObject({ classification: "cots", cotsCategory: cats[1].id, inventoryItemId: gear.id });
      expect(by.get("C")).toMatchObject({ classification: "inhouse", inventoryItemId: gear.id });
    });
  });
