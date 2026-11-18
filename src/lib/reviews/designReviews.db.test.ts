// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("Design Reviews (database): set TEST_DATABASE_URL", () => {});
else
  describe("Design Reviews (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { addComment } = await import("./comments");
    const { finishDesignReview, listDesignReviews, setCommentReview, startDesignReview } = await import("./designReviews");
    const { listComments } = await import("@/lib/data/cadReview");

    const mk = async (name: string, isAdmin = false) => {
      const u = randomUUID();
      const [m] = await db.insert(schema.members).values({ userId: u, email: `${u}@t.org`, name, isAdmin }).returning();
      return m;
    };
    const admin = await mk("DR admin", true);
    const student = await mk("DR student");
    const [robot] = await db.insert(schema.robots).values({ name: "DR bot", year: 2027 }).returning();
    const [shooter, intake] = await db.insert(schema.systems).values([{ robotId: robot.id, name: "Shooter" }, { robotId: robot.id, name: "Intake" }]).returning();
    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      for (const m of [admin, student]) await db.delete(schema.members).where(eq(schema.members.id, m.id));
    });

    it("only an admin starts one, with a state, on its robot's systems", async () => {
      await expect(startDesignReview(student, robot.id, { wholeRobot: true, state: "x" })).rejects.toThrow(/admin/);
      await expect(startDesignReview(admin, robot.id, { wholeRobot: true, state: "  " })).rejects.toThrow(/state/);
      await expect(startDesignReview(admin, robot.id, { wholeRobot: false, systemIds: [randomUUID()], state: "x" })).rejects.toThrow(/Choose/);
    });

    it("links comments in its scope, one open at a time, and is tagged with no version when the robot has none", async () => {
      const dr = await startDesignReview(admin, robot.id, { wholeRobot: false, systemIds: [shooter.id], state: "Shooter at 80%" });
      expect(dr.seq).toBe(1);
      expect(dr.versionLabel).toBeNull();
      await expect(startDesignReview(admin, robot.id, { wholeRobot: true, state: "again" })).rejects.toThrow(/already open/);
      const onShooter = await addComment(student, { robotId: robot.id, systemId: shooter.id, body: "Hood too low" });
      const onRobot = await addComment(student, { robotId: robot.id, systemId: null, body: "Weight?" });
      const onIntake = await addComment(student, { robotId: robot.id, systemId: intake.id, body: "Not in the DR" });
      expect([onShooter.designReviewId, onRobot.designReviewId, onIntake.designReviewId]).toEqual([dr.id, dr.id, null]);
      const listed = await listComments({ robotId: robot.id });
      expect(listed.find((c) => c.id === onShooter.id)?.designReview).toMatchObject({ name: "DR 1", version: null, state: "Shooter at 80%", open: true });
      // ⋮ Add to DR: the author (or an admin); someone else can't.
      const other = await mk("DR other");
      await expect(setCommentReview(other, onIntake.id, dr.id)).rejects.toThrow(/author/);
      await db.delete(schema.members).where(eq(schema.members.id, other.id));
      await setCommentReview(student, onIntake.id, dr.id);
      expect((await listComments({ robotId: robot.id })).filter((c) => c.designReview?.id === dr.id)).toHaveLength(3);
    });

    it("finishes; a version needs the systems on Onshape; the next one starts at the newest robot version", async () => {
      await expect(finishDesignReview(admin, robot.id, { version: "R1" })).rejects.toThrow(/Onshape/);
      await finishDesignReview(admin, robot.id);
      await expect(finishDesignReview(admin, robot.id)).rejects.toThrow(/No Design Review/);
      const after = await addComment(student, { robotId: robot.id, systemId: shooter.id, body: "After it" });
      expect(after.designReviewId).toBeNull();
      await db.insert(schema.robotVersions).values({ robotId: robot.id, seq: 1, name: "R1", systems: [] });
      await db.insert(schema.robotVersions).values({ robotId: robot.id, seq: 2, name: "Pre-DCMP" });
      const dr2 = await startDesignReview(admin, robot.id, { wholeRobot: true, state: "All of it" });
      expect(dr2.versionLabel).toBe("Pre-DCMP");
      const list = await listDesignReviews(robot.id);
      expect(list.map((d) => [d.name, d.open, d.version])).toEqual([
        ["DR 2", true, "Pre-DCMP"],
        ["DR 1", false, null],
      ]);
      expect(list[1].systems).toEqual([{ id: shooter.id, name: "Shooter" }]);
    });
  });
