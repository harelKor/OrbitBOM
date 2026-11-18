// Runs against a real Postgres when TEST_DATABASE_URL is set. R2 is replaced by a fake.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;
const deletedKeys: string[] = [];
vi.mock("@/lib/storage/r2", () => ({ deleteObject: async (key: string) => void deletedKeys.push(key) }));

if (!url) describe.skip("recently deleted (database): set TEST_DATABASE_URL", () => {});
else
  describe("recently deleted (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq, inArray, like, sql } = await import("drizzle-orm");
    const { deleteToTrash, restoreFromTrash, purgeTrash } = await import("./trash");

    const tag = randomUUID().slice(0, 8);
    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Trash Tester" }).returning();

    afterAll(async () => {
      await db.delete(schema.deletedRecords).where(like(schema.deletedRecords.label, `%${tag}%`));
      await db.delete(schema.robots).where(like(schema.robots.name, `%${tag}%`));
      await db.delete(schema.inventoryItems).where(like(schema.inventoryItems.name, `%${tag}%`));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("brings a deleted robot back with its systems, parts, history and versions", async () => {
      const [robot] = await db.insert(schema.robots).values({ name: `Trash bot ${tag}`, year: 2027 }).returning();
      const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Intake" }).returning();
      const [part] = await db.insert(schema.parts).values({ systemId: system.id, onshapeName: `Plate ${tag}`, lastModifiedBy: member.id }).returning();
      await db.insert(schema.partHistory).values({ partId: part.id, field: "note", oldValue: null, newValue: "deburr", via: "ui", memberId: member.id, batchId: randomUUID() });
      // A system names its current version, which names the system: restored in two steps.
      const [version] = await db.insert(schema.systemVersions).values({ systemId: system.id, state: "committed", changes: [], name: "V1" }).returning();
      await db.update(schema.systems).set({ currentVersionId: version.id }).where(eq(schema.systems.id, system.id));
      await db.insert(schema.partFiles).values({ partId: part.id, type: "drawing", r2Key: `parts/${tag}.pdf`, filename: "drawing.pdf", contentType: "application/pdf" });

      const where = eq(schema.robots.id, robot.id);
      await db.transaction((tx) => deleteToTrash(tx, { kind: "robot", label: robot.name, root: schema.robots, where, memberId: member.id, fileKeys: [`parts/${tag}.pdf`] }));
      expect(await db.select().from(schema.parts).where(eq(schema.parts.id, part.id))).toHaveLength(0);

      const [entry] = await db.select().from(schema.deletedRecords).where(eq(schema.deletedRecords.label, robot.name));
      const r = await restoreFromTrash(entry.id);
      expect(r.restored).toBeGreaterThanOrEqual(6);
      const [backSystem] = await db.select().from(schema.systems).where(eq(schema.systems.id, system.id));
      expect(backSystem.currentVersionId).toBe(version.id);
      const [backPart] = await db.select().from(schema.parts).where(eq(schema.parts.id, part.id));
      expect(backPart).toMatchObject({ onshapeName: `Plate ${tag}`, lastModifiedBy: member.id });
      expect(backPart.createdAt).toBeInstanceOf(Date);
      expect(await db.select().from(schema.partHistory).where(eq(schema.partHistory.partId, part.id))).toHaveLength(1);
      expect(await db.select().from(schema.partFiles).where(eq(schema.partFiles.partId, part.id))).toHaveLength(1);
      expect(await db.select().from(schema.deletedRecords).where(eq(schema.deletedRecords.id, entry.id))).toHaveLength(0);
    });

    it("deletes and brings back a system with its CAD updates and comments in a design review", async () => {
      const [robot] = await db.insert(schema.robots).values({ name: `System bot ${tag}`, year: 2027 }).returning();
      const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: `Shooter ${tag}`, drawers: { done: "x" } }).returning();
      const [part] = await db.insert(schema.parts).values({ systemId: system.id, onshapeName: `Flywheel ${tag}` }).returning();
      const [version] = await db.insert(schema.systemVersions).values({ systemId: system.id, state: "committed", changes: [], name: "V1" }).returning();
      await db.update(schema.systems).set({ currentVersionId: version.id }).where(eq(schema.systems.id, system.id));
      await db.insert(schema.cadUpdates).values({ systemId: system.id, robotId: robot.id, did: "d", microversion: "m", label: "V1" });
      const [review] = await db.insert(schema.designReviews).values({ robotId: robot.id, seq: 1, wholeRobot: false, systemIds: [system.id], state: "open" }).returning();
      const [comment] = await db
        .insert(schema.reviewComments)
        .values({ robotId: robot.id, systemId: system.id, body: "chamfer", designReviewId: review.id, doneVersionId: version.id })
        .returning();

      const where = eq(schema.systems.id, system.id);
      await db.transaction((tx) => deleteToTrash(tx, { kind: "system", label: system.name, root: schema.systems, where, memberId: member.id }));
      expect(await db.select().from(schema.systems).where(where)).toHaveLength(0);
      expect(await db.select().from(schema.reviewComments).where(eq(schema.reviewComments.id, comment.id))).toHaveLength(0);

      const [entry] = await db.select().from(schema.deletedRecords).where(eq(schema.deletedRecords.label, system.name));
      expect(entry.kind).toBe("system");
      await restoreFromTrash(entry.id);
      const [back] = await db.select().from(schema.systems).where(where);
      expect(back.currentVersionId).toBe(version.id);
      expect(await db.select().from(schema.parts).where(eq(schema.parts.id, part.id))).toHaveLength(1);
      expect(await db.select().from(schema.cadUpdates).where(eq(schema.cadUpdates.systemId, system.id))).toHaveLength(1);
      const [backComment] = await db.select().from(schema.reviewComments).where(eq(schema.reviewComments.id, comment.id));
      expect(backComment).toMatchObject({ designReviewId: review.id, doneVersionId: version.id });
    });

    it("brings back an item with its stock moves and relinks its parts", async () => {
      const [robot] = await db.insert(schema.robots).values({ name: `Item bot ${tag}`, year: 2027 }).returning();
      const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Drive" }).returning();
      const [item] = await db.insert(schema.inventoryItems).values({ name: `Bearing ${tag}`, category: "bearings", inStock: 4 }).returning();
      const [part] = await db.insert(schema.parts).values({ systemId: system.id, onshapeName: `Bearing ${tag}`, classification: "cots", inventoryItemId: item.id }).returning();
      await db.insert(schema.inventoryMoves).values({ itemId: item.id, delta: 4, reason: "counted", via: "ui" });

      await db.transaction((tx) => deleteToTrash(tx, { kind: "item", label: item.name, root: schema.inventoryItems, where: eq(schema.inventoryItems.id, item.id), memberId: member.id }));
      const [unlinked] = await db.select().from(schema.parts).where(eq(schema.parts.id, part.id));
      expect(unlinked.inventoryItemId).toBeNull();

      const [entry] = await db.select().from(schema.deletedRecords).where(eq(schema.deletedRecords.label, item.name));
      await restoreFromTrash(entry.id);
      const [relinked] = await db.select().from(schema.parts).where(eq(schema.parts.id, part.id));
      expect(relinked.inventoryItemId).toBe(item.id);
      expect(await db.select().from(schema.inventoryMoves).where(eq(schema.inventoryMoves.itemId, item.id))).toHaveLength(1);
    });

    it("won't bring back a part whose system is gone, and purges old entries with their files", async () => {
      const [robot] = await db.insert(schema.robots).values({ name: `Purge bot ${tag}`, year: 2027 }).returning();
      const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Arm" }).returning();
      const [part] = await db.insert(schema.parts).values({ systemId: system.id, onshapeName: `Manual ${tag}`, isManual: true }).returning();
      await db.transaction((tx) =>
        deleteToTrash(tx, { kind: "part", label: `Manual ${tag}`, root: schema.parts, where: eq(schema.parts.id, part.id), memberId: null, fileKeys: [`parts/old-${tag}.pdf`] }),
      );
      await db.delete(schema.systems).where(eq(schema.systems.id, system.id));
      const [entry] = await db.select().from(schema.deletedRecords).where(eq(schema.deletedRecords.label, `Manual ${tag}`));
      await expect(restoreFromTrash(entry.id)).rejects.toThrow(/Restore that first/);

      await db.update(schema.deletedRecords).set({ deletedAt: sql`now() - interval '31 days'` }).where(inArray(schema.deletedRecords.id, [entry.id]));
      expect(await purgeTrash()).toBeGreaterThanOrEqual(1);
      expect(deletedKeys).toContain(`parts/old-${tag}.pdf`);
    });
  });
