// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { CheckResults } from "./types";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

const RESULTS = (totalG: number): CheckResults => ({ v: 1, weight: { totalG, bySystem: [], parts: [] }, envelope: null, clashes: [], ms: 10 });

if (!url) describe.skip("Design check (database): set TEST_DATABASE_URL", () => {});
else
  describe("Design check (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { loadCheckData, saveCheck, setIgnored, setLimits, setPartWeight } = await import("./store");

    const u = randomUUID();
    const [m] = await db.insert(schema.members).values({ userId: u, email: `${u}@t.org`, name: "Checker" }).returning();
    const [robot] = await db.insert(schema.robots).values({ name: "Check bot", year: 2027 }).returning();
    const [drive] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Drive" }).returning();
    const [bumpers] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Bumpers" }).returning();
    const did = `d${u.slice(0, 8)}`;
    await db.insert(schema.parts).values([
      { systemId: drive.id, sourceDid: did, sourceEid: "e", onshapePartId: "PLATE", onshapeName: "Plate", material: "6061 Aluminum 1/4\"" },
      { systemId: drive.id, sourceDid: did, sourceEid: "e", onshapePartId: "BRACKET", onshapeName: "Bracket", process1: "3d-bambu", geometry: { onshapeMaterial: "PLA" } },
    ]);
    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.partWeights).where(eq(schema.partWeights.key, `${did}:e:PLATE`));
      await db.delete(schema.members).where(eq(schema.members.id, m.id));
    });

    it("knows each part's material, whether it's printed, and weights set by hand", async () => {
      await setPartWeight(`${did}:e:PLATE`, 812.5, m.id);
      const data = (await loadCheckData(robot.id, "final"))!;
      expect(data.facts[`${did}:e:PLATE`]).toEqual({ material: "6061 Aluminum 1/4\"", onshapeMaterial: null, printed: false, setG: 812.5 });
      expect(data.facts[`${did}:e:BRACKET`]).toMatchObject({ onshapeMaterial: "PLA", printed: true, setG: null });
      await setPartWeight(`${did}:e:PLATE`, null, m.id);
      expect((await loadCheckData(robot.id, "final"))!.facts[`${did}:e:PLATE`].setG).toBeNull();
      expect(await loadCheckData(randomUUID(), "final")).toBeNull();
    });

    it("keeps the newest few runs per model and shows the newest", async () => {
      for (const g of [1, 2, 3, 4]) await saveCheck(robot.id, "final", `sig${g}`, RESULTS(g), m.id);
      await saveCheck(robot.id, "basepart", "b1", RESULTS(99), m.id);
      const data = (await loadCheckData(robot.id, "final"))!;
      expect(data.latest).toMatchObject({ sig: "sig4", ranBy: "Checker", model: "final", results: { weight: { totalG: 4 } } });
      const rows = await db.select().from(schema.designChecks).where(eq(schema.designChecks.robotId, robot.id));
      expect(rows.filter((r) => r.model === "final")).toHaveLength(3);
      expect((await loadCheckData(robot.id, "basepart"))!.latest?.sig).toBe("b1");
    });

    it("cleans the limits: numbers above zero, this robot's systems only", async () => {
      const l = await setLimits(robot.id, { weightKg: "52.5", perimeterMm: -3, heightMm: "abc", up: "q", exclude: [bumpers.id, randomUUID()], budgets: { [drive.id]: 20, [randomUUID()]: 5, [bumpers.id]: 0 } });
      expect(l).toEqual({ weightKg: 52.5, perimeterMm: null, heightMm: null, frameZoneMm: null, up: "z", exclude: [bumpers.id], budgets: { [drive.id]: 20 } });
      expect((await loadCheckData(robot.id, "final"))!.limits).toEqual(l);
    });

    it("marks an overlap fine whichever way round, and back", async () => {
      await setIgnored(robot.id, "b:key", "a:key", true, m.id);
      await setIgnored(robot.id, "a:key", "b:key", true, m.id); // the same pair: no second row
      expect((await loadCheckData(robot.id, "final"))!.ignored).toEqual(["a:key|b:key"]);
      await setIgnored(robot.id, "a:key", "b:key", false, m.id);
      expect((await loadCheckData(robot.id, "final"))!.ignored).toEqual([]);
    });
  });
