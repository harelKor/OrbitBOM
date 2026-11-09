// The CAD Review version tree (plan/design-review.md): the design's Onshape versions, newest
// first, each marked where the BOM was updated to it, with the comments added while it was the
// current version and those ticked off at its commit or while it was current (Harel, 2026-11-08).
// Without a kept list of Onshape versions, the BOM's own versions make the tree.

export type OnshapeVersion = { id: string; name: string; createdAt: string; creator?: string | null; description?: string | null };
export type BomVersion = { id: string; label: string; at: string | null; by: string | null; vid: string | null; current: boolean };
// `onshapeVersionId`: written in the Onshape panel on that version, so it sits there whatever its
// date (Harel, 2026-11-09).
export type TreeComment = { id: string; createdAt: string; doneAt: string | null; doneVersionId: string | null; state: "open" | "done" | "approved"; onshapeVersionId?: string | null; onshapeVersionName?: string | null };

export type TreeNode = {
  key: string;
  name: string;
  at: string | null;
  by: string | null;
  description: string | null;
  bom: { id: string; label: string; current: boolean }[]; // BOM versions made from it
  added: string[]; // comment ids
  done: string[];
  // Newer in Onshape than the version the BOM is on: nobody updated the system to it yet.
  ahead: boolean;
};

export function buildTree(onshape: OnshapeVersion[] | null, bom: BomVersion[], comments: TreeComment[]): TreeNode[] {
  const nodes: TreeNode[] = [];
  const byVid = new Map<string, TreeNode>();
  for (const v of [...(onshape ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const node: TreeNode = { key: v.id, name: v.name, at: v.createdAt, by: v.creator ?? null, description: v.description || null, bom: [], added: [], done: [], ahead: false };
    nodes.push(node);
    byVid.set(v.id, node);
  }
  // Each BOM version marks its Onshape version; one with none in the list is a node of its own.
  const nodeOfBom = new Map<string, TreeNode>();
  for (const b of [...bom].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""))) {
    let node = b.vid ? byVid.get(b.vid) : undefined;
    if (!node) {
      node = { key: `bom:${b.id}`, name: b.label, at: b.at, by: b.by, description: null, bom: [], added: [], done: [], ahead: false };
      nodes.push(node);
    }
    node.bom.push({ id: b.id, label: b.label, current: b.current });
    nodeOfBom.set(b.id, node);
  }
  // A comment's Onshape version the kept list doesn't have yet (made after it was last read) is a
  // node of its own, dated by its first comment.
  const sorted = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const c of sorted) {
    if (!c.onshapeVersionId || byVid.has(c.onshapeVersionId)) continue;
    const node: TreeNode = { key: c.onshapeVersionId, name: c.onshapeVersionName ?? "", at: c.createdAt, by: null, description: null, bom: [], added: [], done: [], ahead: false };
    nodes.push(node);
    byVid.set(c.onshapeVersionId, node);
  }
  nodes.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  if (!nodes.length) return [];
  const currentAt = nodes.findLastIndex((n) => n.bom.some((b) => b.current));
  if (currentAt >= 0) for (const n of nodes.slice(currentAt + 1)) n.ahead = !n.bom.length;

  // The version current at a moment: the newest one made by then (the first one for earlier).
  const at = (time: string) => {
    let found = nodes[0];
    for (const n of nodes) if ((n.at ?? "") <= time) found = n;
    return found;
  };
  for (const c of sorted) {
    ((c.onshapeVersionId && byVid.get(c.onshapeVersionId)) || at(c.createdAt)).added.push(c.id);
    if (c.state === "open") continue;
    const node = (c.doneVersionId && nodeOfBom.get(c.doneVersionId)) || (c.doneAt ? at(c.doneAt) : null);
    node?.done.push(c.id);
  }
  return nodes.reverse();
}
