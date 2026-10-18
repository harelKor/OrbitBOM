import { describe, expect, it } from "vitest";
import type { BomRow } from "@/lib/onshape/bom";
import { planMerge, type ExistingPart } from "./merge";

const row = (partId: string, name: string, extra: Partial<BomRow> = {}): BomRow => ({
  sourceDid: "d",
  sourceWid: "w",
  sourceWvm: "w",
  sourceEid: "e",
  onshapePartId: partId,
  onshapeName: name,
  partNumber: null,
  description: null,
  material: "3mm 6061-T6",
  onshapeMaterial: "Aluminum - 6061",
  quantity: 1,
  preProcess: null,
  process1: "cnc",
  process2: null,
  ...extra,
});

const part = (id: string, partId: string, name: string, extra: Partial<ExistingPart> = {}): ExistingPart => ({
  id,
  isManual: false,
  sourceDid: "d",
  sourceEid: "e",
  onshapePartId: partId,
  onshapeName: name,
  removedFromCadAt: null,
  overriddenFields: [],
  description: null,
  material: "3mm 6061-T6",
  quantity: 1,
  preProcess: null,
  process1: "cnc",
  process2: null,
  ...extra,
});

describe("planMerge", () => {
  it("inserts new parts and refreshes changed Onshape fields", () => {
    const plan = planMerge([part("p1", "A", "Plate")], [row("A", "Plate", { quantity: 4 }), row("B", "Tube")]);
    expect(plan.insert.map((r) => r.onshapeName)).toEqual(["Tube"]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]).toMatchObject({ id: "p1", changes: { quantity: 4 }, restore: false, relinked: false });
    expect(plan.remove).toEqual([]);
  });

  it("keeps fields the team overrode", () => {
    const plan = planMerge(
      [part("p1", "A", "Plate", { material: "2mm 6061-T6", overriddenFields: ["material"] })],
      [row("A", "Plate", { material: "5mm 6061-T6" })],
    );
    expect(plan.update[0].changes).toEqual({});
  });

  it("hides parts that left CAD and leaves manual parts alone", () => {
    const plan = planMerge(
      [part("p1", "A", "Plate"), part("m1", "", "Spacer", { isManual: true })],
      [],
    );
    expect(plan.remove).toEqual(["p1"]);
  });

  it("restores a removed part that comes back", () => {
    const plan = planMerge([part("p1", "A", "Plate", { removedFromCadAt: new Date() })], [row("A", "Plate")]);
    expect(plan.update[0]).toMatchObject({ id: "p1", restore: true });
    expect(plan.remove).toEqual([]);
  });

  it("re-links a re-keyed part by name instead of inserting a new one", () => {
    const plan = planMerge([part("p1", "A", "Plate")], [row("ZZ", "Plate")]);
    expect(plan.insert).toEqual([]);
    expect(plan.update[0]).toMatchObject({ id: "p1", relinked: true, identity: { onshapePartId: "ZZ" } });
    expect(plan.remove).toEqual([]);
  });

  it("survives a version bump (workspace/version id changes)", () => {
    const plan = planMerge([part("p1", "A", "Plate")], [row("A", "Plate", { sourceWid: "v9", sourceWvm: "v" })]);
    expect(plan.update[0]).toMatchObject({ relinked: false, identity: { sourceWid: "v9", sourceWvm: "v" } });
  });

  it("re-links each existing part at most once", () => {
    const plan = planMerge([part("p1", "A", "Bolt")], [row("X", "Bolt"), row("Y", "Bolt")]);
    expect(plan.update).toHaveLength(1);
    expect(plan.insert).toHaveLength(1);
  });
});
