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
  return { systems, steps, keys, subOfKey, subName, done, progress };
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
