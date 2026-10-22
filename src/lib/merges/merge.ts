// Merged listings (ref §3 "Merge parts"): several BOM rows shown as one row with the summed
// quantity and a chosen name. The merged row is built from its members on read, and an edit to
// it is fanned out to the members, so statuses, counts and history stay per part and a sync
// keeps working on each member as usual.

import type { PartChanges, PartRow } from "@/lib/parts/changes";

export const MERGE_PREFIX = "merge:";
export const isMergeId = (id: string) => id.startsWith(MERGE_PREFIX);

const COUNTERS = ["donePreprocess", "doneProcess1", "doneProcess2", "stockCount"] as const;

type Member = PartRow & { id: string };

// The row the BOM shows for a merge: the first member's fields, the merge's name, the summed
// quantity and counters.
export function mergedRow<T extends Member>(merge: { id: string; name: string }, members: T[]): T & { memberIds: string[] } {
  const [first] = members;
  const sum = (f: "quantity" | (typeof COUNTERS)[number]) => members.reduce((n, m) => n + m[f], 0);
  return {
    ...first,
    id: `${MERGE_PREFIX}${merge.id}`,
    displayName: merge.name,
    partNumber: first.partNumber,
    quantity: sum("quantity"),
    donePreprocess: sum("donePreprocess"),
    doneProcess1: sum("doneProcess1"),
    doneProcess2: sum("doneProcess2"),
    stockCount: sum("stockCount"),
    memberIds: members.map((m) => m.id),
  };
}

// Turns an edit of the merged row into per-member edits. A counter is spread over the members
// in order, each up to its own quantity (any excess goes to the last). The name belongs to the
// merge itself and quantity comes from CAD, so neither reaches the members.
export function fanOutChanges(
  members: { id: string; quantity: number }[],
  changes: PartChanges,
): { rename?: string | null; perMember: { id: string; changes: PartChanges }[] } {
  const { displayName, quantity: _quantity, ...rest } = changes;
  void _quantity;
  const perMember = members.map((m) => ({ id: m.id, changes: { ...rest } as PartChanges }));
  for (const field of COUNTERS) {
    const total = rest[field];
    if (total === undefined) continue;
    let left = total;
    perMember.forEach((pm, i) => {
      const take = i === members.length - 1 ? Math.max(left, 0) : Math.min(members[i].quantity, Math.max(left, 0));
      pm.changes[field] = take;
      left -= take;
    });
  }
  return {
    ...(displayName !== undefined ? { rename: displayName } : {}),
    perMember: perMember.filter((pm) => Object.keys(pm.changes).length),
  };
}
