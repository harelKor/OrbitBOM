// Two versions of a model drawn together (plan/cad-versions.md, Harel 2026-11-17): the newer one's
// parts under their own keys, the older one's under OLD + key, in one scene. What changed is found
// in the browser from the kept files: a part only on one side was added or removed; one whose
// copies sit elsewhere moved; one whose Part Studio file differs is compared by its mesh
// (`shapeSig`), since another part of the same Part Studio may be what changed. No Onshape calls.
import { sortChanges, type CadChange } from "./cadDiff";

export const OLD = "~";
export const isOld = (k: string) => k.startsWith(OLD);
export const plainKey = (k: string) => (isOld(k) ? k.slice(OLD.length) : k);

export type VersionChange = CadChange & { moved?: boolean };

type Placement = { s: number; k: string; t: number[] };

// Copies' places, rounded to a hundredth of a mm, sorted: the same set in both versions is no move.
const placesOf = (list: Placement[]) =>
  list
    .map((p) => p.t.map((x, i) => (i % 4 === 3 && i < 12 ? Math.round(x * 1e5) : Math.round(x * 1e4))).join(","))
    .sort()
    .join("|");

export function diffVersions(model: { keys: (string | null)[]; placements: Placement[] }, names: Record<string, string>, shapeSig?: (key: string) => string | null): VersionChange[] {
  const newer = new Map<string, Placement[]>();
  const older = new Map<string, Placement[]>();
  for (const p of model.placements) {
    const side = isOld(p.k) ? older : newer;
    const k = plainKey(p.k);
    side.set(k, [...(side.get(k) ?? []), p]);
  }
  const file = (p: Placement) => model.keys[p.s] ?? "";
  const name = (k: string) => names[k] ?? k.slice(k.lastIndexOf(":") + 1);
  const out: VersionChange[] = [];
  for (const [k, a] of newer) {
    const b = older.get(k);
    if (!b) {
      out.push({ key: k, name: name(k), change: "added", geometry: false, after: { file: file(a[0]), k } });
      continue;
    }
    const sameFile = file(a[0]) === file(b[0]);
    let geometry = false;
    let note: string | undefined;
    if (!sameFile) {
      const s1 = shapeSig?.(k) ?? null;
      const s0 = shapeSig?.(OLD + k) ?? null;
      if (!s0 || !s1) [geometry, note] = [true, "Shape not compared"];
      else geometry = s0 !== s1;
    }
    const moved = a.length === b.length && placesOf(a) !== placesOf(b);
    const count = a.length !== b.length ? { from: b.length, to: a.length } : undefined;
    if (!geometry && !moved && !count) continue;
    out.push({
      key: k,
      name: name(k),
      change: "modified",
      geometry,
      ...(count ? { count } : {}),
      ...(moved ? { moved, note: note ?? "Moved" } : note ? { note } : {}),
      before: { file: file(b[0]), k: OLD + k },
      after: { file: file(a[0]), k },
    });
  }
  for (const [k, b] of older) if (!newer.has(k)) out.push({ key: k, name: name(k), change: "removed", geometry: false, before: { file: file(b[0]), k: OLD + k } });
  return sortChanges(out) as VersionChange[];
}
