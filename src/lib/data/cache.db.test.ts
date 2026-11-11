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
  });
