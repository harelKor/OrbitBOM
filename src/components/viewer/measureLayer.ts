// Measure: faces, edges and corners picked like Onshape (hover blue, picked orange), any number;
// their sizes, distance and angle go to the page (measure.ts).
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
  let hoverPick: Pick | null = null;
  let lastLine: [V3, V3] | null = null;
  const kindName = (pk: Pick) => {
    const t = topo.topoOf(pk.m);
    if (pk.kind === "point") return "Point";
    if (pk.kind === "edge") return { line: "Straight edge", circle: "Round edge", other: "Edge" }[t.edges[pk.n].kind];
    return { plane: "Flat face", cylinder: "Round face", other: "Face" }[t.faces[pk.n].kind];
  };
  const report = () => {
    const placed: Picked[] = chosen.map((pk) => {
      const at = topo.placeOf(pk.m, pk.i).elements;
      const t = topo.topoOf(pk.m);
      const name = on.names()?.get(meshes[pk.m].keys[pk.i]) ?? "Part";
      if (pk.kind === "face") {
        const g = meshes[pk.m].mesh.geometry;
        return placeFace(t.faces[pk.n], g.getAttribute("position").array, g.index!.array, at, name);
      }
      if (pk.kind === "edge") return placeEdge(t.edges[pk.n], at, name);
      return placePoint(t.corners[pk.n], at, name);
    });
    const { rows, line } = measurePicks(placed);
    lastLine = line;
    marks.draw(hoverPick, chosen, line);
    const parts = [...new Set(chosen.map((pk) => meshes[pk.m].keys[pk.i]).filter(Boolean))];
    on.measured({ picks: chosen.map((pk, k) => `${kindName(pk)} · ${placed[k].name}`), rows, parts });
    // The part of the newest pick is the page's picked part (its popup), none when cleared.
    const last = chosen.at(-1);
    on.pick(last ? (meshes[last.m].keys[last.i] ?? null) : null);
  };
  const measure = (f: MeasureFilter | null) => {
    const was = filter;
    filter = f;
    if (!f || !was) chosen = [];
    hoverPick = null;
    on.hoverOff();
    report();
  };
  const hover = (pk: Pick | null) => {
    if (pk === hoverPick || (pk && hoverPick && samePick(pk, hoverPick))) return false;
    hoverPick = pk;
    marks.draw(hoverPick, chosen, lastLine);
    return true;
  };
  // A tap adds a pick, a tap on it again drops it (as for parts elsewhere), empty space clears.
  const tap = (pk: Pick | null) => {
    if (!pk) chosen = [];
    else if (chosen.some((q) => samePick(q, pk))) chosen = chosen.filter((q) => !samePick(q, pk));
    else chosen = [...chosen, pk];
    report();
  };
  // Space drops the newest pick, one by one back to the first (Esc, on the page, drops them
  // all) (Harel, 2026-11-09). Not while typing or with a window open.
  const onSpace = (e: KeyboardEvent) => {
    if (e.code !== "Space" || !filter || !chosen.length || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, button, [contenteditable=true]") || document.querySelector("dialog[open]")) return;
    e.preventDefault();
    chosen = chosen.slice(0, -1);
    report();
  };
  window.addEventListener("keydown", onSpace);
  return { filter: () => filter, hover, tap, tools: { measure }, dispose: () => window.removeEventListener("keydown", onSpace) };
}
