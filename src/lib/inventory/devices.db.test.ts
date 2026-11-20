// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/visits", () => ({ currentVisit: async () => null }));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("PC stations (database): set TEST_DATABASE_URL", () => {});
else
  describe("PC stations (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { asc, eq } = await import("drizzle-orm");
    const { moveStock, setStock } = await import("./moves");
    const { itemDevices } = await import("./devices");
    const { STATIONS, stationRoom } = await import("@/config/stations");

    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Stations" }).returning();
    const ctx = { memberId: member.id, via: "ui" as const };
    const [cad] = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.station, "cad"));
    const rows = () => db.select().from(schema.inventoryDevices).where(eq(schema.inventoryDevices.itemId, cad.id)).orderBy(asc(schema.inventoryDevices.position));

    afterAll(async () => {
      await db.transaction((tx) => setStock(tx, cad.id, 0, ctx));
      await db.delete(schema.inventoryMoves).where(eq(schema.inventoryMoves.itemId, cad.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("has the three stations from migration 0100", async () => {
      const all = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.category, "computers-devices"));
      expect(all.map((i) => i.station).sort()).toEqual(STATIONS.map((s) => s.key).sort());
    });

    it("keeps one PC per unit of stock, each change a move", async () => {
      await db.transaction((tx) => setStock(tx, cad.id, 2, ctx));
      await db.transaction((tx) => moveStock(tx, { itemId: cad.id, delta: 1, reason: "received" }, ctx));
      const three = await rows();
      expect(three).toHaveLength(3);
      // A new PC stands in the middle of the station's room on the floor plan.
      const [x, y] = stationRoom("cad")!.centre;
      expect(three[2].x).toBeCloseTo(x, 3);
      expect(three[2].y).toBeCloseTo(y, 3);
      // A PC's Delete takes off that one, not the newest.
      await db.transaction((tx) => moveStock(tx, { itemId: cad.id, delta: -1, reason: "counted", deviceId: three[0].id }, ctx));
      expect((await rows()).map((d) => d.id)).toEqual([three[1].id, three[2].id]);
      const moves = await db.select().from(schema.inventoryMoves).where(eq(schema.inventoryMoves.itemId, cad.id));
      expect(moves.map((m) => m.delta).sort()).toEqual([-1, 1, 2]);
    });

    it("makes the rows when the count was set some other way", async () => {
      await db.update(schema.inventoryItems).set({ inStock: 4 }).where(eq(schema.inventoryItems.id, cad.id));
      expect(await itemDevices(cad.id)).toHaveLength(4);
      expect(await rows()).toHaveLength(4);
    });
  });
