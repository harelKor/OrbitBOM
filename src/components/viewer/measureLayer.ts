// Measure: faces, edges and corners picked like Onshape (hover blue, picked orange), any number;
// their sizes, distance and angle go to the page (measure.ts). Box select adds whole parts.
import { measure as measurePicks, placeEdge, placeFace, placePoint, type Picked, type Row } from "@/lib/model/measure";
import type { V3 } from "@/lib/model/topology";
import { samePick, type Marks, type MeasureFilter, type Pick, type Topo } from "./picking";
import type { PartMesh } from "./types";

// `parts`: the picked parts' keys, each once, in pick order.
export type MeasureInfo = { picks: string[]; rows: Row[]; parts: string[] };
export type MeasureTools = { measure: (filter: MeasureFilter | null) => void };

export type MeasureLayer = {
  filter: () => MeasureFilter | null; // null: measuring is off and a click picks a part
  hover: (pk: Pick | null) => boolean; // the pick under the pointer; false when it didn't change
  tap: (pk: Pick | null) => void; // a click on a pick (or on empty space)
  cycle: (pk: Pick | null) => void; // Select other: the newest pick swapped for this one (null drops it)
  newest: () => Pick | null;
  box: (parts: { m: number; i: number }[], drop?: boolean) => void; // box select: these part copies added (Ctrl: taken off)
  only: (pk: Pick | { m: number; i: number } | null) => void; // just this pick (or this whole part copy) picked: a comment's tag
  parts: () => string[]; // the picked parts' keys, each once, in pick order
  copies: () => { m: number; i: number }[]; // the picked part copies, each once (Y hides them)
  tools: MeasureTools;
  dispose: () => void;
};

export function createMeasureLayer(
  meshes: PartMesh[],
  topo: Topo,
  marks: Marks,
  on: {
    names: () => Map<string, string> | undefined;
    measured: (m: MeasureInfo) => void;
    pick: (key: string | null) => void;
    hoverOff: () => void; // measuring turned on or off: drop the part hover wash
  },
): MeasureLayer {
  let filter: MeasureFilter | null = null;
  let chosen: Pick[] = [];
  let boxed: { m: number; i: number }[] = [];
  let hoverPick: Pick | null = null;
  let lastLine: [V3, V3] | null = null;
  const kindName = (pk: Pick) => {
    const t = topo.topoOf(pk.m);
    // A Geometry sketch's, named as Onshape names them.
    if (meshes[pk.m].sketch) return pk.kind === "point" ? "Sketch point" : t.edges[pk.n]?.kind === "line" ? "Sketch line" : t.edges[pk.n]?.kind === "circle" ? (t.edges[pk.n].closed ? "Sketch circle" : "Sketch arc") : "Sketch curve";
    if (pk.kind === "point") return "Point";
    if (pk.kind === "edge") return { line: "Straight edge", circle: "Round edge", other: "Edge" }[t.edges[pk.n].kind];
    return { plane: "Flat face", cylinder: "Round face", other: "Face" }[t.faces[pk.n].kind];
  };
  const report = () => {
    const placed: Picked[] = chosen.map((pk) => {
      const at = topo.placeOf(pk.m, pk.i).elements;
      const t = topo.topoOf(pk.m);
      const name = meshes[pk.m].sketch?.name ?? on.names()?.get(meshes[pk.m].keys[pk.i]) ?? "Part";
      if (pk.kind === "face") {
        const g = meshes[pk.m].mesh.geometry;
        return placeFace(t.faces[pk.n], g.getAttribute("position").array, g.index!.array, at, name);
      }
      if (pk.kind === "edge") return placeEdge(t.edges[pk.n], at, name);
      return placePoint(t.corners[pk.n], at, name);
    });
    const { rows, line } = measurePicks(placed);
    lastLine = line;
    marks.draw(hoverPick, chosen, line, boxed);
    on.measured({ picks: chosen.map((pk, k) => `${kindName(pk)} · ${placed[k].name}`), rows, parts: parts() });
    // The part of the newest pick is the page's picked part (its popup), none when cleared.
    const last = chosen.at(-1) ?? boxed.at(-1);
    on.pick(last ? (meshes[last.m].keys[last.i] ?? null) : null);
  };
  const parts = () => [...new Set([...chosen, ...boxed].map((pk) => meshes[pk.m].keys[pk.i]).filter(Boolean))];
  const measure = (f: MeasureFilter | null) => {
    const was = filter;
    filter = f;
    if (!f || !was) [chosen, boxed] = [[], []];
    hoverPick = null;
    on.hoverOff();
    report();
  };
  const hover = (pk: Pick | null) => {
    if (pk === hoverPick || (pk && hoverPick && samePick(pk, hoverPick))) return false;
    hoverPick = pk;
    marks.draw(hoverPick, chosen, lastLine, boxed);
    return true;
  };
  // A tap adds a pick, a tap on it again drops it (as for parts elsewhere), empty space clears.
  const tap = (pk: Pick | null) => {
    if (!pk) [chosen, boxed] = [[], []];
    else if (chosen.some((q) => samePick(q, pk))) chosen = chosen.filter((q) => !samePick(q, pk));
    else chosen = [...chosen, pk];
    report();
  };
  const cycle = (pk: Pick | null) => {
    chosen = chosen.slice(0, -1);
    if (pk && !chosen.some((q) => samePick(q, pk))) chosen.push(pk);
    report();
  };
  const box = (more: { m: number; i: number }[], drop = false) => {
    const has = (list: { m: number; i: number }[], p: { m: number; i: number }) => list.some((q) => q.m === p.m && q.i === p.i);
    if (drop) {
      boxed = boxed.filter((p) => !has(more, p));
      chosen = chosen.filter((p) => !has(more, p));
    } else boxed = [...boxed, ...more.filter((p) => !has(boxed, p))];
    report();
  };
  const only = (pk: Pick | { m: number; i: number } | null) => {
    if (filter === null) filter = "any";
    [chosen, boxed] = !pk ? [[], []] : "kind" in pk ? [[pk], []] : [[], [pk]];
    report();
  };
  // Space drops the newest pick, one by one back to the first (Esc, on the page, drops them
  // all) (Harel, 2026-11-09). Not while typing or with a window open.
  const onSpace = (e: KeyboardEvent) => {
    if (e.code !== "Space" || !filter || !(chosen.length || boxed.length) || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, button, [contenteditable=true]") || document.querySelector("dialog[open]")) return;
    e.preventDefault();
    if (chosen.length) chosen = chosen.slice(0, -1);
    else boxed = boxed.slice(0, -1);
    report();
  };
  window.addEventListener("keydown", onSpace);
  const copies = () => {
    const seen = new Set<string>();
    return [...chosen, ...boxed].filter((p) => !meshes[p.m].sketch && !seen.has(`${p.m}:${p.i}`) && !!seen.add(`${p.m}:${p.i}`)).map(({ m, i }) => ({ m, i }));
  };
  return { filter: () => filter, hover, tap, cycle, newest: () => chosen.at(-1) ?? null, box, only, parts, copies, tools: { measure }, dispose: () => window.removeEventListener("keydown", onSpace) };
}
