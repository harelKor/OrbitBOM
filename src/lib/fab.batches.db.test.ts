// Runs against a real Postgres when TEST_DATABASE_URL is set.
// Audit 2026-11-25 (BOM-1, FAB-1, FAB-2, FAB-3): a laser → QA → CNC part through To Fab's batches
// keeps its laser count and its QA approval.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

const who = vi.hoisted(() => ({ id: "", name: "Fab Tester" }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/visits", () => ({ currentVisit: async () => null }));
vi.mock("@/lib/mode", () => ({ requireCapability: async () => who, statusChangeDenied: async () => null }));

const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("Fab batches across processes (database): set TEST_DATABASE_URL", () => {});
else
  describe("Fab batches across processes (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { applyPartChanges } = await import("./parts/apply");
    const { createFabBatch, moveToFabBatch, setGroupStatus } = await import("@/app/(app)/groups/actions");
    const { computeStatus, partStatusLabel } = await import("./status");

    const tag = randomUUID().slice(0, 8);
    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: who.name }).returning();
    who.id = member.id;
    const [robot] = await db.insert(schema.robots).values({ name: `Fab bot ${tag}`, year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Intake" }).returning();
    const cnc = { machine: "cnc", done: 0, qa: true, qaDone: false };
    const row = { systemId: system.id, material: "3mm 6061-T6", quantity: 2, process1: "laser", addedProcesses: [cnc] };
    const [plate, second, done] = await db
      .insert(schema.parts)
      .values([
        { ...row, onshapeName: `Plate ${tag}`, designState: "Released" },
        // Already through the laser and approved for CNC, loose under Released.
        { ...row, onshapeName: `Side ${tag}`, designState: null, doneProcess1: 2, addedProcesses: [{ ...cnc, qaDone: true }] },
        { ...row, onshapeName: `Done ${tag}`, designState: "In Stock" },
      ])
      .returning();
    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    const read = async (id: string) => (await db.select().from(schema.parts).where(eq(schema.parts.id, id)))[0];
    const batchOf = async (id: string) =>
      (await db.select({ id: schema.partGroups.id, machine: schema.partGroups.machine }).from(schema.groupMembers).innerJoin(schema.partGroups, eq(schema.partGroups.id, schema.groupMembers.groupId)).where(eq(schema.groupMembers.partId, id)))[0];

    it("laser, then QA, then a CNC batch that keeps the laser's count", async () => {
      expect(await createFabBatch(robot.id, [plate.id], "laser")).not.toHaveProperty("error");
      await applyPartChanges([plate.id], { add: { doneProcess1: 2 } }, { memberId: member.id, via: "ui" });
      let p = await read(plate.id);
      expect(computeStatus(p)).toBe("Ready for QA");
      // BOM-1: no count at CNC before the QA.
      await applyPartChanges([plate.id], { addAt: { process: 2, delta: 1 } }, { memberId: member.id, via: "ui" });
      expect((await read(plate.id)).addedProcesses[0].done).toBe(0);
      await applyPartChanges([plate.id], { qa: "approve" }, { memberId: member.id, via: "ui" });
      expect(await batchOf(plate.id)).toBeUndefined();
      // FAB-1: batching it at CNC leaves its laser count and its QA alone.
      expect(await createFabBatch(robot.id, [plate.id], "cnc")).not.toHaveProperty("error");
      p = await read(plate.id);
      expect(p.doneProcess1).toBe(2);
      expect(p.addedProcesses[0]).toMatchObject({ done: 0, qaDone: true });
      expect((await batchOf(plate.id))?.machine).toBe("cnc");
    });

    it("joins and sets a CNC batch at each part's process", async () => {
      const batch = (await batchOf(plate.id))!;
      // FAB-2: the batch's own status is Released P2+; joining it used to fail with "Unknown status."
      expect(await moveToFabBatch(batch.id, [second.id], null, "Released P2+")).not.toHaveProperty("error");
      expect((await read(second.id)).doneProcess1).toBe(2);
      expect(await setGroupStatus(batch.id, "In Process 1")).not.toHaveProperty("error");
      for (const id of [plate.id, second.id]) {
        const p = await read(id);
        expect(partStatusLabel(p)).toBe("In Process 2");
        expect(p.doneProcess1).toBe(2);
        expect(p.addedProcesses[0].qaDone).toBe(true);
      }
    });

    // Harel, 2026-11-26: a status picked at CNC keeps the laser's count and the QA.
    it("keeps the laser's work when a status is picked at CNC", async () => {
      await applyPartChanges([plate.id], { status: "Post Processing" }, { memberId: member.id, via: "ui" });
      let p = await read(plate.id);
      expect(partStatusLabel(p)).toBe("Post Processing");
      expect(p.doneProcess1).toBe(2);
      expect(p.addedProcesses[0].qaDone).toBe(true);
      // The Finished drop (and the post-processing tick): the final QA, every process made.
      await applyPartChanges([plate.id], { status: "Ready for QA", atProcess: true }, { memberId: member.id, via: "ui" });
      p = await read(plate.id);
      expect(computeStatus(p)).toBe("Ready for QA");
      expect(p.doneProcess1).toBe(2);
      expect(p.addedProcesses[0]).toMatchObject({ done: 2, qaDone: true });
      // Reproduction still starts over from Process 1.
      await applyPartChanges([plate.id], { status: "Reproduction", note: "Bent" }, { memberId: member.id, via: "ui" });
      expect((await read(plate.id)).doneProcess1).toBe(0);
    });

    it("refuses finished parts in a new batch", async () => {
      // FAB-3: a finished card can't start a batch (it used to go back to Released).
      const r = await createFabBatch(robot.id, [done.id], "laser");
      expect(r).toHaveProperty("error");
      expect((await read(done.id)).designState).toBe("In Stock");
    });
  });
