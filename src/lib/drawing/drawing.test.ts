import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { readBodies } from "./brep";
import { plateDrawing, readPlate } from "./plate";
import { drawingSvg } from "./svg";

// Real Onshape answers from Harel's test document (2026-10-21), btType keys removed.
const fixture = (name: string, kind: string) =>
  JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.${kind}.json.gz`, import.meta.url))).toString());
const body = (name: string) => readBodies(fixture(name, "bodydetails"), fixture(name, "tessellatededges"))[0];

it("reads the test plate's thickness, holes and inner corners exactly", () => {
  const plate = readPlate(body("plate"))!;
  expect(plate.thickness).toBeCloseTo(6.7, 3);
  expect(plate.size[0]).toBeCloseTo(154.05, 1);
  expect(plate.size[1]).toBeCloseTo(89.72, 1);
  expect(plate.holes.map((h) => Math.round(h.d * 100) / 100).sort()).toEqual([28.7, 4.2]);
  expect(plate.minInnerRadius).toBeCloseTo(3.5, 3);
  expect(plate.outline.length).toBeGreaterThan(5);
});

it("notes only the M5 tap, the bearing fit and the max tool", () => {
  const d = plateDrawing(readPlate(body("plate"))!, { name: "Plate", partNumber: "1690-101", material: "6061 Aluminum 1/4in" });
  expect(d.scale).toBe(1);
  expect(d.notes.map((n) => n.text)).toEqual([
    "M5 tapped",
    "light press fit for\n1/2IN HEX Bearing\nØ28.7",
    "Max tool Ø7 (inner corners R3.5)",
  ]);
  expect(d.dims.map((x) => x.text)).toEqual(["6.7"]);
  const svg = drawingSvg(d);
  expect(svg).toContain("1690-101");
  expect(svg).toContain("6.7 mm plate");
});

it("doesn't treat tubes and shafts as plates", () => {
  for (const name of ["square-tube", "round-tube", "hex-shaft"]) expect(readPlate(body(name))).toBeNull();
});
