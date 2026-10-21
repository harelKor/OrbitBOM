import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { readBodies } from "./brep";
import { partDrawing } from "./layout";
import { readPart } from "./read";
import { drawingSvg } from "./svg";

// Real Onshape answers from Harel's test document (2026-10-21), btType keys removed.
const fixture = (name: string, kind: string) =>
  JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.${kind}.json.gz`, import.meta.url))).toString());
const part = (name: string) => readPart(readBodies(fixture(name, "bodydetails"), fixture(name, "tessellatededges"))[0]);
const round = (n: number) => Math.round(n * 100) / 100;

it("reads the test plate's thickness, holes and inner corners exactly", () => {
  const p = part("plate");
  if (p?.kind !== "plate") throw new Error(`plate read as ${p?.kind}`);
  expect(round(p.thickness)).toBe(6.7);
  expect(round(p.front.w)).toBe(154.05);
  expect(round(p.front.h)).toBe(89.72);
  expect(p.front.holes.map((h) => round(h.d)).sort()).toEqual([28.7, 4.2]);
  expect(round(p.minInnerRadius!)).toBe(3.5);
});

it("notes only the M5 tap, the bearing fit and the max tool on a plate", () => {
  const d = partDrawing(part("plate")!, { name: "1690-101 Side plate", material: "6061 Aluminum 1/4in" });
  expect(d.notes.map((n) => n.text)).toEqual(["M5 tapped", "light press fit for\n1/2IN HEX Bearing\nØ28.7", "Max tool Ø7 (inner corners R3.5)"]);
  expect(d.dims.map((x) => x.text)).toEqual(["6.7"]);
  const svg = drawingSvg(d);
  expect(svg).toContain("1690-101 Side plate");
  expect(svg).toContain("6.7 mm plate");
});

it("reads the square tube's size, wall, length and drilled faces", () => {
  const p = part("square-tube");
  if (p?.kind !== "square-tube") throw new Error(`square tube read as ${p?.kind}`);
  expect(p.size.map(round).sort((a, b) => a - b)).toEqual([20, 50]);
  expect(round(p.wall!)).toBe(1.5);
  expect(round(p.length)).toBe(100);
  expect(p.long).toHaveLength(1); // drilled through one pair of walls
  expect(p.long[0].holes.map((h) => round(h.d)).sort()).toEqual([5.2, 5.41]);
  const d = partDrawing(p, { name: "Tube" });
  expect(d.notes).toEqual([]); // no taps or fits on it
  expect(d.dims.map((x) => x.text).sort()).toEqual(["1.5", "100", "20", "50"]);
});

it("reads the hex shaft's flats, bore and length", () => {
  const p = part("hex-shaft");
  if (p?.kind !== "hex-shaft") throw new Error(`hex shaft read as ${p?.kind}`);
  expect(round(p.acrossFlats)).toBe(12.7);
  expect(round(p.bore!)).toBe(4.2);
  expect(round(p.length)).toBe(50);
  expect(partDrawing(p, { name: "Shaft" }).notes.map((n) => n.text)).toEqual(["M5 tapped"]);
});

it("reads the round tube's OD, ID and length", () => {
  const p = part("round-tube");
  if (p?.kind !== "round-tube") throw new Error(`round tube read as ${p?.kind}`);
  expect([round(p.od), round(p.id!), round(p.length)]).toEqual([20, 17, 100]);
  const d = partDrawing(p, { name: "Round" });
  expect(d.dims.map((x) => x.text)).toEqual(["100", "Ø20", "Ø17"]);
  expect(d.notes.map((n) => n.text)).toEqual(["Wall 1.5"]);
});
