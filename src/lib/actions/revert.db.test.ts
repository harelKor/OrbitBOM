// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
const url = process.env.TEST_DATABASE_URL;

if (!url)
  describe.skip("action revert, undo and redo (database): set TEST_DATABASE_URL", () => {});
else
  describe("action revert, undo and redo (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { redoBatch, revertSystemUpdate, revertVisit, undoLatest } =
      await import("./revert");
    const { listRecentActions } = await import("@/lib/data/actions");

    const userId = randomUUID();
    const [member] = await db
      .insert(schema.members)
      .values({ userId, email: `${userId}@t.org`, name: "Undo Tester" })
      .returning();
    const [robot] = await db
      .insert(schema.robots)
      .values({ name: "Undo bot", year: 2027 })
      .returning();
    const [system] = await db
      .insert(schema.systems)
      .values({ robotId: robot.id, name: "Climber" })
      .returning();
    const [a, b] = await db
      .insert(schema.parts)
      .values([
        {
          systemId: system.id,
          onshapeName: "Hook",
          material: "Aluminum 6061",
          quantity: 2,
        },
        {
          systemId: system.id,
          onshapeName: "Plate",
          material: "Polycarbonate",
          quantity: 1,
        },
      ])
      .returning();
    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    const part = async (id: string) =>
      (await db.select().from(schema.parts).where(eq(schema.parts.id, id)))[0];
    // A change as the app records it: the part and its history row.
    const edit = async (
      id: string,
      field: "material" | "quantity",
      from: unknown,
      to: unknown,
      ctx: { batchId: string; visitId?: string; at: Date },
    ) => {
      await db
        .update(schema.parts)
        .set({ [field]: to })
        .where(eq(schema.parts.id, id));
      await db
        .insert(schema.partHistory)
        .values({
          partId: id,
          field,
          oldValue: from,
          newValue: to,
          memberId: member.id,
          via: "ui",
          batchId: ctx.batchId,
          visitId: ctx.visitId,
          page: `/robots/${robot.id}/systems/${system.id}`,
          at: ctx.at,
        });
    };
    const t = (min: number) => new Date(Date.now() - (60 - min) * 60_000);

    it("reverts a whole visit, field changed twice included, and skips what was edited since", async () => {
      const visitId = randomUUID();
      await edit(a.id, "material", "Aluminum 6061", "Steel", {
        batchId: randomUUID(),
        visitId,
        at: t(1),
      });
      await edit(a.id, "material", "Steel", "Delrin", {
        batchId: randomUUID(),
        visitId,
        at: t(2),
      });
      await edit(b.id, "quantity", 1, 3, {
        batchId: randomUUID(),
        visitId,
        at: t(3),
      });
      await edit(b.id, "quantity", 3, 5, { batchId: randomUUID(), at: t(4) }); // someone else's later edit
      const r = await revertVisit(visitId, member.id);
      expect(r.skipped).toBe(1);
      expect(r.message).toMatch(/Material on 1 part/);
      expect((await part(a.id)).material).toBe("Aluminum 6061");
      expect((await part(b.id)).quantity).toBe(5);
    });

    it("undoes the member's newest change, then the one before, and redoes", async () => {
      await edit(b.id, "material", "Polycarbonate", "Aluminum 6061", {
        batchId: randomUUID(),
        at: t(70),
      });
      await edit(a.id, "quantity", 2, 4, { batchId: randomUUID(), at: t(71) }); // newer than the revert above
      const exclude: string[] = [];
      const first = await undoLatest(member.id, exclude);
      exclude.push(first.undone!, first.batchId!);
      expect((await part(a.id)).quantity).toBe(2);
      const second = await undoLatest(member.id, exclude);
      exclude.push(second.undone!, second.batchId!);
      expect((await part(b.id)).material).toBe("Polycarbonate");

      const redo = await redoBatch(second.batchId!, member.id);
      expect(redo.message).toMatch(/^Redid Material/);
      expect((await part(b.id)).material).toBe("Aluminum 6061");
    });

    it("lists a System Update and reverts it to the version before", async () => {
      const [v1, v2] = await db
        .insert(schema.systemVersions)
        .values([
          {
            systemId: system.id,
            state: "committed" as const,
            seq: 1,
            committedAt: t(20),
            committedBy: member.id,
            changes: [],
          },
          {
            systemId: system.id,
            state: "committed" as const,
            seq: 2,
            committedAt: t(30),
            committedBy: member.id,
            changes: [
              {
                key: "k",
                partId: a.id,
                change: "modified" as const,
                name: "Hook",
                partNumber: null,
                fields: { quantity: { from: 2, to: 6 } },
                geometry: false,
              },
            ],
          },
        ])
        .returning();
      const snap = (quantity: number) => ({
        sourceDid: null,
        sourceWid: null,
        sourceWvm: null,
        sourceEid: null,
        onshapePartId: null,
        onshapeName: "Hook",
        partNumber: null,
        description: null,
        material: "Aluminum 6061",
        onshapeMaterial: null,
        quantity,
        preProcess: null,
        process1: null,
        process2: null,
        sig: "s",
      });
      const rows = await db
        .insert(schema.partVersions)
        .values([
          {
            versionId: v1.id,
            partId: a.id,
            change: "baseline" as const,
            snapshot: snap(2),
          },
          {
            versionId: v2.id,
            partId: a.id,
            change: "modified" as const,
            snapshot: snap(6),
          },
        ])
        .returning();
      await db
        .update(schema.parts)
        .set({ quantity: 6, versionRowId: rows[1].id })
        .where(eq(schema.parts.id, a.id));
      await db
        .update(schema.systems)
        .set({ currentVersionId: v2.id })
        .where(eq(schema.systems.id, system.id));

      const actions = await listRecentActions({
        robotId: robot.id,
        memberId: member.id,
        systemId: system.id,
      });
      const update = actions.find((x) => x.kind === "system");
      expect(update).toMatchObject({
        visitId: v2.id,
        label: "#2",
        fields: ["1 changed"],
        partCount: 1,
      });

      const r = await revertSystemUpdate(v2.id, member.id);
      expect(r.message).toMatch(/^Reverted to #1/);
      expect((await part(a.id)).quantity).toBe(2);
      await expect(revertSystemUpdate(v1.id, member.id)).rejects.toThrow(
        /first version/,
      );
    });
  });
