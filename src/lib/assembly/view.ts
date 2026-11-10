// The Assembly page's view of its data (pure, for the browser): which parts each place holds,
// each column's steps, what's done, and the model cut down to some parts.
import type { ViewerModel } from "@/components/viewer/types";
import type { AssemblyData, AssemblyStep } from "@/lib/data/assembly";
import { defaultSubName, placeKey, type Place } from "./groups";

export type SubInfo = { code: string; name: string; keys: string[] };
export type SystemInfo = { id: string; name: string; keys: string[]; subs: SubInfo[] };

export type Book = {
  systems: SystemInfo[];
  steps: (p: Place) => AssemblyStep[]; // a column's steps, in order
  keys: (p: Place) => string[]; // the parts in a place (a system: all of its parts)
  subOfKey: Map<string, Place>; // part key → its sub-assembly
  stepById: Map<string, AssemblyStep>;
  subName: (systemId: string, code: string) => string;
  done: (s: AssemblyStep) => boolean;
  progress: (p: Place) => { done: number; total: number };
};

export function makeBook(data: AssemblyData): Book {
  const subName = (systemId: string, code: string) => data.subNames[`${systemId}:${code}`] ?? defaultSubName(code);
  const subOfKey = new Map<string, Place>();
  const systems: SystemInfo[] = data.systems.map((s) => {
    const own = data.parts.filter((p) => p.systemId === s.id);
    const codes = [...new Set(own.flatMap((p) => (p.sub ? [p.sub] : [])))].sort();
    for (const p of own) if (p.sub) subOfKey.set(p.key, { systemId: s.id, sub: p.sub });
    return {
      id: s.id,
      name: s.name,
      keys: [...new Set(own.map((p) => p.key))],
      subs: codes.map((code) => ({ code, name: subName(s.id, code), keys: [...new Set(own.filter((p) => p.sub === code).map((p) => p.key))] })),
    };
  });
  const byPlace = new Map<string, AssemblyStep[]>();
  for (const st of data.steps) {
    const k = placeKey({ systemId: st.systemId, sub: st.subCode });
    byPlace.set(k, [...(byPlace.get(k) ?? []), st]);
  }
  for (const list of byPlace.values()) list.sort((a, b) => a.position - b.position);
  const steps = (p: Place) => byPlace.get(placeKey(p)) ?? [];
  const keys = (p: Place) => {
    const sys = systems.find((s) => s.id === p.systemId);
    if (!sys) return [];
    return p.sub ? (sys.subs.find((x) => x.code === p.sub)?.keys ?? []) : sys.keys;
  };
  // A sub-assembly step is done when its sub-assembly's steps all are; with none, by its own tick.
  const done = (s: AssemblyStep): boolean => {
    if (s.kind === "sub" && s.subRef) {
      const inner = steps({ systemId: s.systemId, sub: s.subRef });
      if (inner.length) return inner.every(done);
    }
    return !!s.tick;
  };
  const progress = (p: Place) => {
    const list = steps(p);
    return { done: list.filter(done).length, total: list.length };
  };
  return { systems, steps, keys, subOfKey, stepById: new Map(data.steps.map((s) => [s.id, s])), subName, done, progress };
}

// The colours of earlier steps brought into a step whole, one per step, in the order they were added.
export const REF_COLORS = ["#14b8a6", "#a78bfa", "#facc15", "#f472b6", "#38bdf8", "#84cc16"];

// Every part a step ends up with: its own and those of the earlier steps it brings in (and theirs).
export function wholeKeys(book: Book, s: AssemblyStep, seen = new Set<string>()): string[] {
  if (seen.has(s.id)) return [];
  seen.add(s.id);
  const refs = s.stepRefs.flatMap((id) => book.stepById.get(id) ?? []);
  return [...new Set([...stepKeys(book, s), ...refs.flatMap((r) => wholeKeys(book, r, seen))])];
}

// The earlier steps a step brings in whole: each with its number in the column, parts and colour.
export function stepRefsOf(book: Book, list: AssemblyStep[], s: AssemblyStep) {
  return s.stepRefs.flatMap((id, i) => {
    const ref = book.stepById.get(id);
    return ref ? [{ step: ref, n: list.indexOf(ref) + 1, keys: wholeKeys(book, ref), color: REF_COLORS[i % REF_COLORS.length] }] : [];
  });
}

// The parts a step shows: the ones it adds (a sub-assembly step: the whole sub-assembly).
export function stepKeys(book: Book, s: AssemblyStep): string[] {
  return s.kind === "sub" && s.subRef ? book.keys({ systemId: s.systemId, sub: s.subRef }) : s.partKeys;
}

// The parts of the steps before `index` in a column: drawn plain under the new ones.
export function earlierKeys(book: Book, list: AssemblyStep[], index: number): string[] {
  return [...new Set(list.slice(0, index).flatMap((s) => stepKeys(book, s)))];
}

// The model with only these parts: the other placements dropped and the Part Studio files nothing
// uses any more left out, so a sub-assembly or a step loads only its own files.
export function subModel(model: ViewerModel, keys: Iterable<string>): ViewerModel {
  const want = new Set(keys);
  const placements = model.placements.filter((p) => want.has(p.k));
  const used = new Set(placements.map((p) => p.s));
  return { ...model, studios: model.studios.map((u, s) => (used.has(s) ? u : null)), placements };
}
