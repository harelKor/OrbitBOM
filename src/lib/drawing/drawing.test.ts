import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, it } from "vitest";
import { type Body, type Face, readBodies, type V3 } from "./brep";
import { applyEdits, dimAt, dimFrame, dimHit, dimOff, dimRect, dimSpan, linkNotes, maxToolText, measure, noteBox, partDrawing, refToSheet, sheetToRef, turnViews, viewXf } from "./layout";
import { readPart } from "./read";
import { drawingSvg } from "./svg";
import { drawingSummary } from "./summary";

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
  expect(d.notes.map((n) => n.text)).toEqual(["M5 tapped", "light press fit for\n1/2IN HEX Bearing\nØ28.7", "Max tool 6mm (inner corners R3.5)"]);
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

it("sums a drawing up for the AI tools, edits included", () => {
  const s = drawingSummary(part("plate")!, { hidden: ["tool"], added: [{ id: "a1", text: "Deburr", at: [20, 20] }] }, { name: "Plate" });
  expect(s).toMatchObject({ kind: "plate", thickness_mm: 6.7, max_tool_mm: 7 });
  expect(s.holes.find((h) => h.diameter_mm === 4.2)?.tap).toBe("M5 tapped");
  expect(s.holes.find((h) => h.diameter_mm === 28.7)?.bearing).toBe("1/2IN HEX Bearing");
  expect(s.notes.find((n) => n.id === "tool")).toMatchObject({ hidden: true });
  expect(s.notes.at(-1)).toEqual({ id: "a1", text: "Deburr", added: true });
});

// A 10×10×80 bar like Harel's 1691-26-411-07A: three M5 taps on one face (one tapped through to
// the opposite face), one on a third face and both ends tapped.
function bar(): Body {
  const V = (x: number, y: number, z: number): V3 => [x, y, z];
  const plane = (id: string, n: V3, center: V3, area: number): Face => ({ id, type: "PLANE", area, concave: false, dir: n, out: n, loops: 1, center });
  const tap = (id: string, dir: V3, center: V3): Face => ({ id, type: "CYLINDER", area: 26, concave: true, dir, radius: 2.1, loops: 2, center });
  const c = [V(0, 0, 0), V(10, 0, 0), V(10, 10, 0), V(0, 10, 0)];
  const top = c.map(([x, y]) => V(x, y, 80));
  const edges: V3[][] = [...c.map((p, i) => [p, c[(i + 1) % 4]]), ...top.map((p, i) => [p, top[(i + 1) % 4]]), ...c.map((p, i) => [p, top[i]])];
  return {
    id: "bar",
    name: "1691-26-411-07A",
    edges,
    faces: [
      plane("+x", V(1, 0, 0), V(10, 5, 40), 800),
      plane("-x", V(-1, 0, 0), V(0, 5, 40), 800),
      plane("+y", V(0, 1, 0), V(5, 10, 40), 800),
      plane("-y", V(0, -1, 0), V(5, 0, 40), 800),
      plane("+z", V(0, 0, 1), V(5, 5, 80), 100),
      plane("-z", V(0, 0, -1), V(5, 5, 0), 100),
      tap("a", V(1, 0, 0), V(9, 5, 20)),
      tap("b", V(1, 0, 0), V(9, 5, 40)),
      tap("c", V(1, 0, 0), V(9, 5, 60)),
      tap("b2", V(1, 0, 0), V(1, 5, 40)),
      tap("d", V(0, 1, 0), V(5, 1, 70)),
      tap("e1", V(0, 0, 1), V(5, 5, 79)),
      tap("e2", V(0, 0, 1), V(5, 5, 1)),
    ],
  };
}

it("draws every drilled face of a square bar, and its tapped ends", () => {
  const p = readPart(bar());
  if (p?.kind !== "square-tube") throw new Error(`bar read as ${p?.kind}`);
  expect(p.long).toHaveLength(2); // +x (with the tap through to −x) and −y
  expect(p.long.map((v) => v.holes.length)).toEqual([3, 1]);
  expect(p.end.holes).toHaveLength(1);
  const d = partDrawing(p, { name: "Bar" });
  expect(d.notes.map((n) => n.text).sort()).toEqual(["3× M5 tapped", "M5 tapped", "M5 tapped, both ends"]);
});

it("keeps notes clear of each other and of the sizes", () => {
  for (const d of [partDrawing(readPart(bar())!, { name: "Bar" }), partDrawing(part("plate")!, { name: "Plate" })]) {
    const notes = d.notes.map((n) => noteBox(n.text, n.at, n.leader).rect);
    const sizes = d.dims.map(dimRect);
    const hit = (a: (typeof notes)[0], b: (typeof notes)[0]) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    notes.forEach((a, i) => {
      notes.slice(i + 1).forEach((b) => expect(hit(a, b)).toBe(false));
      sizes.forEach((b) => expect(hit(a, b)).toBe(false));
    });
  }
});

it("max tool snaps down to the shop's endmills", () => {
  expect(maxToolText(1.75)).toBe("Max tool 1/8in (inner corners R1.75)");
  expect(maxToolText(1.5)).toBe("Max tool 3mm (inner corners R1.5)");
  expect(maxToolText(2.5)).toBe("Max tool 5mm (inner corners R2.5)");
  expect(maxToolText(10)).toBe("Max tool 6mm (inner corners R10)");
  expect(maxToolText(1.2)).toBe("Max tool Ø2.4 (inner corners R1.2)");
});

it("links a bearing fit note to its inventory item by name, clickable only in the app", () => {
  const d = linkNotes(partDrawing(part("plate")!, { name: "Plate" }), [{ name: "1/2in hex bearing", itemId: "item-1" }]);
  expect(d.notes.find((n) => n.kind === "fit")?.link).toEqual({ name: "1/2IN HEX Bearing", itemId: "item-1" });
  expect(d.notes.find((n) => n.kind === "tap")?.link).toBeUndefined();
  const live = drawingSvg(d, { live: true });
  expect(live).toContain('data-fit-item="item-1"');
  expect(live).toContain('class="fit-name">1/2IN HEX Bearing</tspan>');
  expect(drawingSvg(d)).not.toContain("fit-link");
});

it("links a note added with the Fit picker to its part", () => {
  const base = partDrawing(part("plate")!, { name: "Plate" });
  const d = applyEdits(base, { added: [{ id: "note:1", text: "slip fit for\nShaft A", at: [50, 50], fitPartId: "p-1", fitTargetName: "Shaft A" }] });
  expect(d.notes.at(-1)?.link).toEqual({ name: "Shaft A", partId: "p-1" });
  expect(drawingSvg(d, { live: true })).toContain('data-fit-part="p-1"');
});

it("names every view and dimension, and offers snap points and edges", () => {
  const d = partDrawing(part("plate")!, { name: "Plate" });
  expect(d.views.map((v) => v.key)).toEqual(["front", "side"]);
  expect(d.dims.map((x) => x.id)).toEqual(["dim:thickness"]);
  expect(d.holes.every((h) => h.view === "front")).toBe(true);
  expect(d.snaps.filter((s) => s.kind === "center")).toHaveLength(2);
  expect(d.edges.length).toBeGreaterThan(4);
  const tube = partDrawing(part("square-tube")!, { name: "Tube" });
  expect(tube.dims.map((x) => x.id).sort()).toEqual(["dim:height", "dim:length", "dim:wall", "dim:width"]);
});

it("retypes, hides and moves automatic dimensions", () => {
  const base = partDrawing(part("square-tube")!, { name: "Tube" });
  const len = base.dims.find((x) => x.id === "dim:length")!;
  const d = applyEdits(base, { text: { "dim:length": "100 ±0.2" }, hidden: ["dim:wall"], shift: { "dim:length": [0, -5] } });
  const shown = d.dims.find((x) => x.id === "dim:length")!;
  expect(shown.text).toBe("100 ±0.2");
  expect(shown.at).toBeCloseTo(len.at - 5);
  expect(d.dims.some((x) => x.id === "dim:wall")).toBe(false);
});

it("measures an added dimension in the part's millimetres, at any scale", () => {
  const base = partDrawing(part("plate")!, { name: "Plate" });
  const front = base.views.find((v) => v.key === "front")!;
  // The front view's full width, corner to corner.
  const [a, b] = [refToSheet(base, { v: "front", p: [0, 0] })!, refToSheet(base, { v: "front", p: [front.w, 0] })!];
  expect(measure(base, "front", a, b, "h")).toBeCloseTo(154.05, 1);
  const off = dimOff(a, b, "h", a[1] + 10);
  expect(dimAt(a, b, "h", off)).toBeCloseTo(a[1] + 10);
  const d = applyEdits(base, { dims: [{ id: "dim:1", a: sheetToRef(base, a, { view: "front" })!, b: sheetToRef(base, b, { view: "front" })!, dir: "h", off }] });
  expect(d.dims.at(-1)).toMatchObject({ id: "dim:1", text: "154.05", added: true });
  expect(applyEdits(base, { dims: [{ id: "dim:1", a: { v: "front", p: [0, 0] }, b: { v: "front", p: [10, 0] }, dir: "h", off: 8, text: "10 H7" }] }).dims.at(-1)?.text).toBe("10 H7");
});

it("keeps an added note's arrow on its hole when the drawing is laid out again", () => {
  const base = partDrawing(part("plate")!, { name: "Plate" });
  const hole = base.holes.find((h) => Math.abs(h.d - 28.7) < 0.1)!;
  const tip: [number, number] = [hole.at[0] + hole.r, hole.at[1]];
  const ref = sheetToRef(base, tip, { hole: hole.id })!;
  expect(ref).toMatchObject({ v: "front", hole: hole.id });
  // The same part drawn at another scale and place: the tip follows the hole's edge.
  const moved = { ...base, holes: base.holes.map((h) => (h.id === hole.id ? { ...h, at: [h.at[0] + 20, h.at[1] + 5] as [number, number], r: h.r * 2 } : h)) };
  const d = applyEdits(moved, { added: [{ id: "n1", text: "Deburr", at: [0, 0], leader: tip, ref, off: [10, -10] }] });
  const n = d.notes.at(-1)!;
  expect(n.leader![0]).toBeCloseTo(hole.at[0] + 20 + hole.r * 2);
  expect(n.at[0]).toBeCloseTo(n.leader![0] + 10);
});

it("reads a hole's diameter on a diameter dimension unless retyped", () => {
  const base = partDrawing(part("plate")!, { name: "Plate" });
  const hole = base.holes.find((h) => Math.abs(h.d - 4.2) < 0.1)!;
  const ref = sheetToRef(base, [hole.at[0], hole.at[1] - hole.r], { hole: hole.id })!;
  const d = applyEdits(base, { added: [{ id: "d1", text: "", dia: true, at: [0, 0], ref, off: [5, -8] }] });
  expect(d.notes.at(-1)).toMatchObject({ kind: "dia", text: "Ø4.2" });
  expect(applyEdits(base, { added: [{ id: "d1", text: "2× Ø4.2", dia: true, at: [0, 0], ref, off: [5, -8] }] }).notes.at(-1)?.text).toBe("2× Ø4.2");
});

it("still reads older saves' sheet positions", () => {
  const base = partDrawing(part("plate")!, { name: "Plate" });
  const d = applyEdits(base, { moved: { tool: [40, 40] }, arrows: {}, added: [{ id: "a", text: "x", at: [50, 60], leader: [70, 80] }] });
  expect(d.notes.find((n) => n.id === "tool")?.at).toEqual([40, 40]);
  expect(d.notes.at(-1)).toMatchObject({ at: [50, 60], leader: [70, 80] });
});

it("slides a dimension's text along its line and runs the line on under it", () => {
  const d = { id: "x", a: [20, 50] as [number, number], b: [80, 50] as [number, number], at: 40, dir: "h" as const, text: "60" };
  expect(dimFrame(d).tc).toBe(50);
  const slid = { ...d, tx: 45 };
  expect(dimFrame(slid).tc).toBe(95);
  const [, end] = dimSpan(slid);
  expect(end).toBeGreaterThan(95); // the line reaches past the text
  expect(dimHit(slid, [95, 37])).toBe(true); // on the text, 3 mm above the line
  expect(dimHit(slid, [50, 37])).toBe(false); // where the text was
  expect(dimHit(slid, [50, 40])).toBe(true); // still on the line
});

it("moves an automatic dimension's text sideways from its shift", () => {
  const base = partDrawing(part("square-tube")!, { name: "Tube" });
  const d = applyEdits(base, { shift: { "dim:length": [30, -4] } });
  const len = d.dims.find((x) => x.id === "dim:length")!;
  expect(len.tx).toBe(30);
  expect(len.at).toBeCloseTo(base.dims.find((x) => x.id === "dim:length")!.at - 4);
});

it("draws an aligned dimension between slanted parallel lines, text along them", () => {
  const base = partDrawing(part("plate")!, { name: "Plate" });
  // Two points 10 mm apart across a 45° slant on the front view.
  const a = refToSheet(base, { v: "front", p: [40, 40] })!;
  const b = refToSheet(base, { v: "front", p: [40 + 10 / Math.SQRT2, 40 + 10 / Math.SQRT2] })!;
  const d = applyEdits(base, { dims: [{ id: "al", a: sheetToRef(base, a, { view: "front" })!, b: sheetToRef(base, b, { view: "front" })!, dir: "a", off: 6 }] });
  const dim = d.dims.at(-1)!;
  expect(dim).toMatchObject({ dir: "a", text: "10", at: 6 });
  const f = dimFrame(dim);
  expect(Math.abs(f.angle)).toBeCloseTo(45, 0);
  expect(drawingSvg(d)).toContain("rotate(");
  // The line sits 6 mm beside a→b; a point there is on it.
  expect(dimHit(dim, f.P((f.lo + f.hi) / 2, 6))).toBe(true);
  expect(dimHit(dim, f.P((f.lo + f.hi) / 2, 20))).toBe(false);
});

it("moves, scales and turns a view with its dimensions, notes and points", () => {
  const flat0 = partDrawing(part("square-tube")!, { name: "Tube" });
  const end0 = flat0.views.find((v) => v.key === "end")!;
  const views = { end: { cx: 150, cy: 100, s: end0.s * 2, r: 90 } };
  const ref = sheetToRef(flat0, [end0.x + 1, end0.y + 1], { view: "end" })!;
  const flat = applyEdits(partDrawing(part("square-tube")!, { name: "Tube" }, views), { dims: [{ id: "dim:x", a: ref, b: { ...ref, p: [ref.p[0] + 10, ref.p[1]] }, dir: "h", off: -8 }] });
  const d = turnViews(flat);
  const end = d.views.find((v) => v.key === "end")!;
  expect(viewXf(end).c.map(round)).toEqual([150, 100]);
  expect(end.s).toBe(end0.s * 2);
  // The width dimension still reads the part's width, now measured upright.
  const width = d.dims.find((x) => x.id === "dim:width")!;
  expect(width.text).toBe(flat0.dims.find((x) => x.id === "dim:width")!.text);
  expect(width.dir).toBe("a");
  expect(Math.abs(width.u![0])).toBeLessThan(1e-9);
  // An added dimension keeps its measured length; its points turned a quarter turn about the centre.
  const added = d.dims.find((x) => x.id === "dim:x")!;
  expect(added.text).toBe("10");
  expect(round(Math.abs(added.b[1] - added.a[1]))).toBe(round(10 * end.s));
  // A point on the turned view maps back to the same place on the part.
  const back = sheetToRef(d, refToSheet(d, ref)!, { view: "end" })!;
  expect(back.p.map(round)).toEqual(ref.p.map(round));
  expect(drawingSvg(d)).toContain("<svg");
});
