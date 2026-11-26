// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("server cache (database): set TEST_DATABASE_URL", () => {});
else
  describe("server cache (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { listInventoryNames } = await import("./inventory");

    const version = async (name: string) => (await db.select().from(schema.dataVersions).where(eq(schema.dataVersions.name, name)))[0]?.version ?? 0;
    const made: string[] = [];
    afterAll(async () => {
      for (const id of made) await db.delete(schema.inventoryItems).where(eq(schema.inventoryItems.id, id));
    });

    it("counts a transaction's writes once, when it commits", async () => {
      const before = await version("inventory_items");
      await db.transaction(async (tx) => {
        const rows = await tx.insert(schema.inventoryItems).values([{ name: `Cache A ${randomUUID()}` }, { name: `Cache B ${randomUUID()}` }]).returning();
        made.push(...rows.map((r) => r.id));
        await tx.update(schema.inventoryItems).set({ note: "x" }).where(eq(schema.inventoryItems.id, rows[0].id));
        // Not committed yet: the counter hasn't moved.
        expect(await version("inventory_items")).toBe(before);
      });
      expect(await version("inventory_items")).toBe(before + 1);
    });

    it("serves a kept read until the table changes", async () => {
      const name = `Cache C ${randomUUID()}`;
      const first = await listInventoryNames();
      expect(first.some((i) => i.name === name)).toBe(false);
      // A caller changing what it got doesn't change the kept copy.
      first.length = 0;
      expect((await listInventoryNames()).length).toBeGreaterThan(0);
      const [row] = await db.insert(schema.inventoryItems).values({ name }).returning();
      made.push(row.id);
      expect((await listInventoryNames()).some((i) => i.name === name)).toBe(true);
    });

    it("reloads only the rows that changed when only their table moved (cachedRows)", async () => {
      const { cachedRows } = await import("./cache");
      const { and, asc, inArray, like, sql } = await import("drizzle-orm");
      const items = schema.inventoryItems;
      const prefix = `Rows ${randomUUID()}`;
      const rows = await db.insert(items).values(["a", "b", "c", "d"].map((x) => ({ name: `${prefix} ${x}`, note: "1" }))).returning();
      made.push(...rows.map((r) => r.id));
      const xmin = sql<string>`"inventory_items"."xmin"::text`;
      const mine = like(items.name, `${prefix}%`);
      const cols = { id: items.id, name: items.name, note: items.note, xmin };
      const asked: string[][] = [];
      const read = () =>
        cachedRows("inventory_items", ["inventory_items"], {
          all: db.select(cols).from(items).where(mine).orderBy(asc(items.name)),
          manifest: () => db.select({ id: items.id, v: xmin }).from(items).where(mine).orderBy(asc(items.name)),
          some: (ids) => {
            asked.push(ids);
            return db.select(cols).from(items).where(and(mine, inArray(items.id, ids))).orderBy(asc(items.name));
          },
          idOf: (r) => r.id,
          vOf: (r) => r.xmin,
        });
      const strip = (list: { id: string; name: string; note: string | null }[]) => list.map(({ id, name, note }) => ({ id, name, note }));
      expect((await read()).map((r) => r.note)).toEqual(["1", "1", "1", "1"]);
      await db.update(items).set({ note: "2" }).where(eq(items.id, rows[1].id));
      expect(strip(await read())).toEqual(strip(await db.select(cols).from(items).where(mine).orderBy(asc(items.name))));
      expect(asked).toEqual([[rows[1].id]]);
      // A row leaving the list and a new one: nothing else is read again.
      await db.update(items).set({ name: `gone ${prefix}` }).where(eq(items.id, rows[2].id));
      const [e] = await db.insert(items).values({ name: `${prefix} e`, note: "1" }).returning();
      made.push(e.id);
      expect((await read()).map((r) => r.name)).toEqual([`${prefix} a`, `${prefix} b`, `${prefix} d`, `${prefix} e`]);
      expect(asked[1]).toEqual([e.id]);
      expect((await read()).map((r) => r.note)).toEqual(["1", "2", "1", "1"]);
      expect(asked).toHaveLength(2);
    });

    it("watches inventory groups and conditions (migration 0093)", async () => {
      const before = { groups: await version("inventory_groups"), conditions: await version("inventory_conditions") };
      const [g] = await db.insert(schema.inventoryGroups).values({ name: `Cache G ${randomUUID()}` }).returning();
      const [c] = await db.insert(schema.inventoryConditions).values({ label: `Cache ${randomUUID()}`, color: "#000" }).returning();
      await db.delete(schema.inventoryGroups).where(eq(schema.inventoryGroups.id, g.id));
      await db.delete(schema.inventoryConditions).where(eq(schema.inventoryConditions.id, c.id));
      expect(await version("inventory_groups")).toBe(before.groups + 2);
      expect(await version("inventory_conditions")).toBe(before.conditions + 2);
    });
  });
