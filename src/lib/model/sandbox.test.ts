import { expect, it } from "vitest";
import { decodeMeshes, encodeMeshes } from "./mesh";
import { BIG_FILES, sandboxRobot, sandboxStudio } from "./sandbox";
import { topology } from "./topology";

it("builds the sandbox's parts as real faces: the plate's 24 holes come out round", () => {
  const studio = decodeMeshes(encodeMeshes(sandboxStudio()).slice().buffer);
  const plate = studio.find((m) => m.partId === "PLATE")!;
  const t = topology(plate.positions, plate.indices);
  const holes = t.faces.filter((f) => f.kind === "cylinder");
  expect(holes).toHaveLength(24);
  for (const h of holes) expect(h.radius).toBeCloseTo(0.008, 4);
  // Top, bottom and four sides are flat.
  expect(t.faces.filter((f) => f.kind === "plane")).toHaveLength(6);
  expect(studio.find((m) => m.partId === "PC_BELLY")!.appearance!.opacity).toBeLessThan(1);
});

it("places a few dozen parts in three subsystems, each placed part named", () => {
  const { model, names } = sandboxRobot("/studio");
  expect(model.studios).toEqual(["/studio"]);
  expect(model.groups).toHaveLength(3);
  expect(model.placements.length).toBeGreaterThan(20);
  expect(model.placements.length).toBeLessThan(60);
  const parts = new Set(sandboxStudio().map((m) => m.partId));
  for (const p of model.placements) {
    expect(names[p.k]).toBeTruthy();
    expect(parts.has(p.k.slice(p.k.lastIndexOf(":") + 1))).toBe(true);
    expect(p.t).toHaveLength(16);
  }
});

it("the big variant (?big=1) has ~5000 instances over several cacheable files", () => {
  const { model, names } = sandboxRobot("/studio", { key: "dev/k", big: true });
  expect(model.placements.length).toBeGreaterThan(4500);
  expect(model.placements.length).toBeLessThan(6000);
  expect(model.studios).toHaveLength(BIG_FILES);
  expect(new Set(model.studios).size).toBe(BIG_FILES);
  expect(model.keys).toEqual(model.studios.map((_, i) => `dev/k/${i}`));
  expect(new Set(model.placements.map((p) => p.s)).size).toBe(BIG_FILES);
  for (const p of model.placements) expect(names[p.k]).toBeTruthy();
  expect(model.placements.filter((p) => p.k.startsWith("sandbox:r0-")).length).toBe(sandboxRobot("/studio").model.placements.length);
  expect(sandboxRobot("/studio", { key: "dev/k" }).model.keys).toEqual(["dev/k"]);
});
