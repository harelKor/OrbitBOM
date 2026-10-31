import { describe, expect, it } from "vitest";
import { cellText, parseBom, partKey } from "./bom";

const headers = [
  { id: "h-name", name: "Name" },
  { id: "h-qty", name: "Quantity" },
  { id: "h-desc", name: "Description" },
  { id: "h-mat", name: "Material" },
  { id: "h-p1", name: "Process 1" },
  { id: "h-p2", name: "Process 2" },
];
const src = (partId: string) => ({ documentId: "d1", elementId: "e1", partId, wvmType: "w", wvmId: "w1" });

describe("parseBom", () => {
  it("maps columns and machine names", () => {
    const { rows, unknownMachines, skipped } = parseBom({
      headers,
      rows: [
        {
          itemSource: src("JHD"),
          headerIdToValue: {
            "h-name": "Side plate",
            "h-qty": 2,
            "h-desc": "",
            "h-mat": { displayName: "Aluminum - 6061" },
            "h-p1": { value: "CNC", displayName: "CNC" },
            "h-p2": "plasma",
          },
        },
        { itemSource: { documentId: "d1", elementId: "e2" }, headerIdToValue: { "h-name": "Subassembly" } },
      ],
    });
    expect(skipped).toBe(1);
    expect(unknownMachines).toEqual(["plasma"]);
    expect(rows).toEqual([
      {
        sourceDid: "d1",
        sourceWid: "w1",
        sourceWvm: "w",
        sourceEid: "e1",
        onshapePartId: "JHD",
        onshapeName: "Side plate",
        partNumber: null,
        description: null,
        material: "Aluminum - 6061",
        onshapeMaterial: "Aluminum - 6061",
        quantity: 2,
        preProcess: null,
        process1: "cnc",
        process2: null,
      },
    ]);
  });

  it("puts PLA parts without a process on the Bambu", () => {
    const row = (partId: string, mat: string, p1?: string) => ({
      itemSource: src(partId),
      headerIdToValue: { "h-name": partId, "h-mat": { displayName: mat }, ...(p1 ? { "h-p1": p1 } : {}) },
    });
    const { rows } = parseBom({ headers, rows: [row("a", "PLA"), row("b", "PLA", "CNC"), row("c", "Plate")] });
    expect(rows.map((r) => r.process1)).toEqual(["3d-bambu", "cnc", null]);
  });

  it("adds up repeated parts", () => {
    const row = { itemSource: src("A"), headerIdToValue: { "h-name": "Spacer", "h-qty": 3 } };
    expect(parseBom({ headers, rows: [row, row] }).rows[0].quantity).toBe(6);
  });
});

describe("cellText", () => {
  it("reads strings, numbers and Onshape value objects", () => {
    expect(cellText("  x ")).toBe("x");
    expect(cellText(4)).toBe("4");
    expect(cellText({ value: "v", displayName: "Shown" })).toBe("Shown");
    expect(cellText({})).toBeNull();
    expect(cellText("")).toBeNull();
  });
});

it("partKey ignores the workspace/version", () => {
  expect(partKey({ sourceDid: "d", sourceEid: "e", onshapePartId: "p", onshapeName: "n" })).toBe("d|e|p|n");
});
