import type { FrozenRef, TreeNode } from "./tree";

// The version tree as one line, oldest first (plan/cad-versions.md, Harel 2026-11-17): each
// version, then its sub-versions. "The version before" one is the nearest older item that can be
// drawn: what visiting colours against, and what Compare to last version shows.
export type VersionItem = {
  key: string;
  label: string;
  at: string | null;
  ref: FrozenRef | null;
  bomIds: string[]; // its BOM versions (newest last)
  vid: string | null; // its Onshape version
  subId: string | null; // a sub-version's update
};

export function flatVersions(tree: TreeNode[]): VersionItem[] {
  const out: VersionItem[] = [];
  for (const n of [...tree].reverse()) {
    out.push({ key: n.key, label: n.name || "Unnamed", at: n.at, ref: n.ref, bomIds: n.bom.map((b) => b.id), vid: n.key.startsWith("bom:") ? null : n.key, subId: null });
    for (const s of n.subs) out.push({ key: `sub:${s.id}`, label: s.label, at: s.at, ref: s.ref ?? null, bomIds: [], vid: null, subId: s.id });
  }
  return out;
}

export function previousOf(list: VersionItem[], key: string): VersionItem | null {
  const i = list.findIndex((x) => x.key === key);
  for (let j = i - 1; j >= 0; j--) if (list[j].ref) return list[j];
  return null;
}

export const sameRef = (a: FrozenRef | null | undefined, b: FrozenRef | null | undefined) => !!a && !!b && a.wvm === b.wvm && a.wvmid === b.wvmid;
