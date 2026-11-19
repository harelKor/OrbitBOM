// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

const VIEW = {
  pose: { target: [0.1, 0.2, 0.3], dir: [0, 0, 1], half: 0.5, projection: "ortho" },
  vis: { hidden: [{ key: "d:e:P1", at: [0.01, 0, 0] }], isolated: null, ghost: false, clear: [] },
  section: { planes: [{ from: "front", normal: [0, -1, 0], origin: [0, 0, 0], offset: 12, tilt: [0, 0], flip: false }], open: true },
  display: "shaded",
  colors: "cad",
};

if (!url) describe.skip("Named views and comment pins (database): set TEST_DATABASE_URL", () => {});
else
  describe("Named views and comment pins (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { addComment } = await import("./comments");
    const { listNamedViews, saveNamedView, deleteNamedView } = await import("./namedViews");
    const { listComments } = await import("@/lib/data/cadReview");

    const mk = async (name: string, isAdmin = false) => {
      const u = randomUUID();
      const [m] = await db.insert(schema.members).values({ userId: u, email: `${u}@t.org`, name, isAdmin }).returning();
      return m;
    };
    const a = await mk("Viewer A");
    const b = await mk("Viewer B");
    const [robot] = await db.insert(schema.robots).values({ name: "Views bot", year: 2027 }).returning();
    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      for (const m of [a, b]) await db.delete(schema.members).where(eq(schema.members.id, m.id));
    });

    it("a comment keeps its view and pin; junk is dropped", async () => {
      const c = await addComment(a, { robotId: robot.id, systemId: null, body: "Look here", view: VIEW, pin: [12.345, -3, 400] });
      expect(c.pin).toEqual([12.35, -3, 400]);
      expect(c.view?.section?.open).toBe(false); // put back cut, with the panel shut
      expect(c.view?.vis?.hidden).toHaveLength(1);
      const junk = await addComment(a, { robotId: robot.id, systemId: null, body: "Junk", view: { pose: "x" }, pin: [1, 2] });
      expect(junk.view).toBeNull();
      expect(junk.pin).toBeNull();
      const listed = await listComments({ robotId: robot.id });
      expect(listed.find((x) => x.id === c.id)).toMatchObject({ pin: [12.35, -3, 400], view: { edges: false } }); // an old Shaded view: no face borders
    });

    it("named views: saved per robot, the same name replaces, only the author deletes", async () => {
      const { id } = await saveNamedView(a, robot.id, "  Intake side ", VIEW);
      await saveNamedView(b, robot.id, "Intake side", { ...VIEW, display: "translucent" });
      const list = await listNamedViews(robot.id);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id, name: "Intake side", by: "Viewer B", view: { edges: false } });
      await expect(saveNamedView(a, robot.id, "", VIEW)).rejects.toThrow("Name the view");
      await expect(saveNamedView(a, robot.id, "Bad", { pose: null })).rejects.toThrow("couldn't be read");
      await expect(deleteNamedView(a, id)).rejects.toThrow("Only whoever saved it");
      await deleteNamedView(b, id);
      expect(await listNamedViews(robot.id)).toEqual([]);
    });
  });
