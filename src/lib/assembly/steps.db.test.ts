// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("Assembly steps (database): set TEST_DATABASE_URL", () => {});
else
  describe("Assembly steps (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { saveStep, reorderSteps, tickStep, deleteStep, nameSub } = await import("./steps");
    const { loadAssembly } = await import("@/lib/data/assembly");

    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Noa", team: "build" }).returning();
    const [robot] = await db.insert(schema.robots).values({ name: "Assembly bot", year: 2027 }).returning();
    const [other] = await db.insert(schema.robots).values({ name: "Other bot", year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Intake" }).returning();
    await db.insert(schema.parts).values([
      { systemId: system.id, sourceDid: "d", sourceEid: "e", onshapePartId: "P1", onshapeName: "Plate", partNumber: "1690-26-421-01" },
      { systemId: system.id, sourceDid: "d", sourceEid: "e", onshapePartId: "P2", onshapeName: "Tube", partNumber: "1690-26-401-01" },
    ]);
    afterAll(async () => {
      for (const r of [robot, other]) await db.delete(schema.robots).where(eq(schema.robots.id, r.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });
    const base = { systemId: system.id, subCode: null, kind: "step" as const, subRef: null, body: "", critical: false, camera: null, imageKey: null };
    const order = async () => (await loadAssembly(robot.id)).steps.filter((s) => !s.subCode).map((s) => s.title);

    it("adds steps at the end or before another, and reorders them", async () => {
      const a = await saveStep(robot.id, member.id, { ...base, title: "A", partKeys: ["d:e:P2"] });
      const c = await saveStep(robot.id, member.id, { ...base, title: "C", partKeys: [] });
      await saveStep(robot.id, member.id, { ...base, title: "B", partKeys: [], before: c.id });
      expect(await order()).toEqual(["A", "B", "C"]);
      const ids = (await loadAssembly(robot.id)).steps.map((s) => s.id);
      await reorderSteps(robot.id, system.id, null, [ids[2], ids[0], ids[1]]);
      expect(await order()).toEqual(["C", "A", "B"]);
      await expect(reorderSteps(robot.id, system.id, null, [ids[0]])).rejects.toThrow("changed meanwhile");

      // A tick stays through a text edit and goes when the parts change.
      await tickStep(robot.id, member.id, a.id, true);
      await saveStep(robot.id, member.id, { ...base, id: a.id, title: "A2", partKeys: ["d:e:P2"] });
      expect((await loadAssembly(robot.id)).steps.find((s) => s.id === a.id)?.tick?.by).toBe("Noa");
      await saveStep(robot.id, member.id, { ...base, id: a.id, title: "A2", partKeys: ["d:e:P1"] });
      expect((await loadAssembly(robot.id)).steps.find((s) => s.id === a.id)?.tick).toBeNull();
      // Bringing an earlier step in whole: kept, and changing it clears the tick too.
      await tickStep(robot.id, member.id, a.id, true);
      const b = (await loadAssembly(robot.id)).steps.find((s) => s.title === "B")!;
      await saveStep(robot.id, member.id, { ...base, id: a.id, title: "A2", partKeys: ["d:e:P1"], stepRefs: [b.id] });
      const a2 = (await loadAssembly(robot.id)).steps.find((s) => s.id === a.id)!;
      expect(a2.stepRefs).toEqual([b.id]);
      expect(a2.tick).toBeNull();
      await expect(saveStep(robot.id, member.id, { ...base, subCode: "42", title: "X", partKeys: [], stepRefs: [b.id] })).rejects.toThrow("isn't in this column");
      await deleteStep(robot.id, c.id);
      expect(await order()).toEqual(["A2", "B"]);

      // Deleting a step another brings in: the ref goes too, and a stale one is left out (ASM-4).
      await tickStep(robot.id, member.id, a.id, true);
      await deleteStep(robot.id, b.id);
      expect((await loadAssembly(robot.id)).steps.find((s) => s.id === a.id)?.stepRefs).toEqual([]);
      await saveStep(robot.id, member.id, { ...base, id: a.id, title: "A3", partKeys: ["d:e:P1"], stepRefs: [b.id] });
      const a3 = (await loadAssembly(robot.id)).steps.find((s) => s.id === a.id)!;
      expect(a3.stepRefs).toEqual([]);
      expect(a3.tick?.by).toBe("Noa");
    });

    it("groups parts by sub-assembly, keeps names, and checks the robot", async () => {
      await nameSub(robot.id, system.id, "42", "Roller arm");
      await saveStep(robot.id, member.id, { ...base, kind: "sub", subRef: "42", title: "", partKeys: [] });
      const data = await loadAssembly(robot.id);
      expect(data.subNames[`${system.id}:42`]).toBe("Roller arm");
      expect(data.parts.map((p) => p.sub).sort()).toEqual(["42", null]);
      await expect(saveStep(other.id, member.id, { ...base, title: "X", partKeys: [] })).rejects.toThrow("isn't on this robot");
      await expect(saveStep(robot.id, member.id, { ...base, title: "", partKeys: [] })).rejects.toThrow("title");
      await expect(saveStep(robot.id, member.id, { ...base, subCode: "42", kind: "sub", subRef: "42", title: "", partKeys: [] })).rejects.toThrow("system's column");
    });
  });
