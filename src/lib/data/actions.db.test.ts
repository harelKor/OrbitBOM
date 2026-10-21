// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const visit = { id: randomUUID(), page: "" };
vi.mock("@/lib/visits", () => ({ currentVisit: async () => (visit.page ? visit : null) }));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("listRecentActions (database): set TEST_DATABASE_URL", () => {});
else
  describe("listRecentActions (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { applyPartChanges } = await import("@/lib/parts/apply");
    const { listRecentActions } = await import("./actions");

    const [member] = await db
      .insert(schema.members)
      .values({ userId: randomUUID(), email: `${randomUUID()}@test`, name: "Dana" })
      .returning();
    const [robot] = await db.insert(schema.robots).values({ name: "Action bot", year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Shooter" }).returning();
    const [a, b] = await db
      .insert(schema.parts)
      .values([
        { systemId: system.id, isManual: true, displayName: "Plate" },
        { systemId: system.id, isManual: true, displayName: "Shaft" },
      ])
      .returning();

    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("groups a page visit's changes into one action", async () => {
      visit.page = `/robots/${robot.id}/systems/${system.id}`;
      await applyPartChanges([a.id], { material: "Aluminum" }, { memberId: member.id, via: "ui" });
      await applyPartChanges([b.id], { note: "deburr" }, { memberId: member.id, via: "ui" });
      // Not from a page: no action.
      await applyPartChanges([a.id], { note: "x" }, { memberId: member.id, via: "mcp" });

      const actions = await listRecentActions(robot.id);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        visitId: visit.id,
        page: visit.page,
        pageName: "Shooter",
        memberName: "Dana",
        partCount: 2,
        firstPartId: b.id,
      });
      expect(actions[0].fields.sort()).toEqual(["Material", "Note"]);
      expect(actions[0].at).toBeInstanceOf(Date);
    });
  });
