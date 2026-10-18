// Inventory groups form a tree through parent_id; these helpers walk it.

export type GroupNode = { id: string; name: string; parentId: string | null };

// "Bearings › Radial"
export function groupPath(groups: GroupNode[], id: string | null): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let g = groups.find((x) => x.id === id); g && !seen.has(g.id); g = groups.find((x) => x.id === g!.parentId)) {
    seen.add(g.id);
    names.unshift(g.name);
  }
  return names.join(" › ");
}

// The group and all its sub-groups, for "show this group's items".
export function subtreeIds(groups: GroupNode[], id: string): Set<string> {
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of groups) {
      if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
        ids.add(g.id);
        grew = true;
      }
    }
  }
  return ids;
}

// Depth-first order with depth, for the tree and for indented <select> options.
export function flattenTree<T extends GroupNode>(groups: T[]): { group: T; depth: number }[] {
  const out: { group: T; depth: number }[] = [];
  const ids = new Set(groups.map((g) => g.id));
  const walk = (parentId: string | null, depth: number) => {
    for (const g of groups.filter((x) => (x.parentId && ids.has(x.parentId) ? x.parentId : null) === parentId)) {
      out.push({ group: g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
