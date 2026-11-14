// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("bulk part edits (database): set TEST_DATABASE_URL", () => {});
else
  describe("bulk part edits (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { applyEachPartChanges } = await import("./apply");
    const { planUndo } = await import("./undo");

    const [robot] = await db.insert(schema.robots).values({ name: `Bulk bot ${randomUUID().slice(0, 6)}`, year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Arm" }).returning();
    const made = await db
      .insert(schema.parts)
      .values(["A", "B", "C", "D"].map((n) => ({ systemId: system.id, onshapeName: n, classification: "inhouse" as const, description: `old ${n}` })))
      .returning();
    const [cots] = await db.insert(schema.parts).values({ systemId: system.id, onshapeName: "E", classification: "cots", description: "old E" }).returning();

    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
    });

    // Plain edits wait and go out grouped; a COTS part in the middle sends them first.
    it("writes every part and every history row, grouped or not", async () => {
      const [a, b, c, d] = made;
      const { batchId, changed } = await applyEachPartChanges(
        [
          { id: a.id, changes: { description: "same" } },
          { id: b.id, changes: { description: "same" } },
          { id: c.id, changes: { description: "own" } },
          { id: cots.id, changes: { description: "cots" } },
          { id: d.id, changes: { description: "same" } },
        ],
        { memberId: null, via: "sync" },
      );
      expect(changed).toBe(5);
      const rows = await db.select().from(schema.parts).where(eq(schema.parts.systemId, system.id));
      const by = new Map(rows.map((r) => [r.onshapeName, r.description]));
      expect(Object.fromEntries(by)).toEqual({ A: "same", B: "same", C: "own", D: "same", E: "cots" });
      const history = await db.select().from(schema.partHistory).where(eq(schema.partHistory.batchId, batchId));
      expect(history.filter((h) => h.field === "description").map((h) => [h.oldValue, h.newValue]).sort()).toEqual(
        [
          ["old A", "same"],
          ["old B", "same"],
          ["old C", "own"],
          ["old D", "same"],
          ["old E", "cots"],
        ].sort(),
      );
      // Undo reads the history back: every part goes back to its old description.
      const plan = await planUndo(batchId);
      expect(JSON.stringify(plan)).toContain("old A");
      expect(JSON.stringify(plan)).toContain("old E");
    });
  });
