// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("To Review (database): set TEST_DATABASE_URL", () => {});
else
  describe("To Review (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { applyPartChanges } = await import("@/lib/parts/apply");
    const { applySuggestions, approveReviews, listAiLogs, listRobotReviews, logAiAction, rejectReviews } = await import("./review");

    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Reviewer" }).returning();
    const [robot] = await db.insert(schema.robots).values({ name: "Review bot", year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Intake" }).returning();
    const [a, b] = await db
      .insert(schema.parts)
      .values([
        { systemId: system.id, onshapeName: "Side plate", classification: "cots" as const },
        { systemId: system.id, onshapeName: "Gusset", classification: "cots" as const, material: "2mm Poly" },
      ])
      .returning();
    const get = async (id: string) => (await db.select().from(schema.parts).where(eq(schema.parts.id, id)))[0];
    const ctx = { memberId: member.id, source: "ai" as const, via: "mcp" as const };

    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("applies a suggestion and queues the part", async () => {
      const { batchId } = await applySuggestions(
        [
          { id: a.id, changes: { material: "3mm 6061-T6", process1: "cnc", classification: "inhouse" }, reason: "3 mm aluminum" },
          { id: b.id, changes: { material: "2mm Poly" }, reason: "unchanged" },
        ],
        ctx,
      );
      const part = await get(a.id);
      expect(part).toMatchObject({ material: "3mm 6061-T6", process1: "cnc", classification: "inhouse" });
      const reviews = await listRobotReviews(robot.id);
      expect(reviews.map((r) => r.partId)).toEqual([a.id]); // b didn't change
      expect(reviews[0].changes.material).toEqual({ from: null, to: "3mm 6061-T6" });
      expect(reviews[0].addedOverrides.sort()).toEqual(["material", "process1"]);
      expect(reviews[0].batchId).toBe(batchId);
      expect(reviews[0].memberName).toBe("Reviewer");
    });

    it("lists an AI action with what it changed and what still waits", async () => {
      const [r] = await listRobotReviews(robot.id);
      await logAiAction({ source: "ai", tool: "set_up_parts", memberId: member.id, batchId: r.batchId, parts: 1, summary: "Set up 1 part: 3 mm aluminum" });
      const [log] = await listAiLogs(5);
      expect(log).toMatchObject({ tool: "set_up_parts", source: "ai", memberName: "Reviewer", waiting: 1, parts: 1 });
      expect(log.changes.map((c) => c.field).sort()).toEqual(["classification", "material", "process1"]);
      expect(log.changes[0]).toMatchObject({ part: "Side plate", system: "Intake", robot: "Review bot" });
    });

    it("keeps the original values when a waiting part is suggested again", async () => {
      await applySuggestions([{ id: a.id, changes: { material: "4mm 6061-T6" }, reason: "4 mm" }], ctx);
      const [r] = await listRobotReviews(robot.id);
      expect(r.changes.material).toEqual({ from: null, to: "4mm 6061-T6" });
      expect(r.batchId).toBeTruthy();
      expect(r.changes.process1).toEqual({ from: null, to: "cnc" });
      expect(r.reason).toBe("4 mm");
    });

    it("rejects back to the old values, but keeps a field edited since", async () => {
      await applyPartChanges([a.id], { process1: "laser" }, { memberId: member.id, via: "ui" });
      const { rejected, keptEdits } = await rejectReviews([a.id], member.id);
      expect({ rejected, keptEdits }).toEqual({ rejected: 1, keptEdits: 1 });
      const part = await get(a.id);
      expect(part).toMatchObject({ material: null, process1: "laser", classification: "cots" });
      expect(part.overriddenFields).toEqual(["process1"]);
      expect(await listRobotReviews(robot.id)).toEqual([]);
    });

    it("approves by keeping the change", async () => {
      await applySuggestions([{ id: b.id, changes: { process1: "laser" }, reason: "poly" }], { ...ctx, source: "rule", via: "ui" });
      expect(await approveReviews([b.id])).toBe(1);
      expect((await get(b.id)).process1).toBe("laser");
      expect(await listRobotReviews(robot.id)).toEqual([]);
    });
  });
