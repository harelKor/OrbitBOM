// Update BOM merge rules (plan §4, "Sync merge rules"):
// - a BOM row matches an existing part by identity (Part Studio + partId + Onshape name);
// - Onshape fields refresh unless the part has them in overridden_fields;
// - app-only fields (status, counters, people, notes, files, groups…) are never touched;
// - a part missing from the BOM is hidden (removed_from_cad_at), keeping its data;
// - a part that reappears under a new identity with the same name is re-linked, keeping its data.

import { partKey, type BomRow } from "@/lib/onshape/bom";
import { ONSHAPE_FIELDS, type PartChanges } from "@/lib/parts/changes";

export type ExistingPart = {
  id: string;
  isManual: boolean;
  sourceDid: string | null;
  sourceEid: string | null;
  onshapePartId: string | null;
  onshapeName: string | null;
  removedFromCadAt: Date | null;
  overriddenFields: string[];
  description: string | null;
  material: string | null;
  quantity: number;
  preProcess: string | null;
  process1: string | null;
  process2: string | null;
};

export type IdentityUpdate = {
  sourceDid: string;
  sourceWid: string | null;
  sourceWvm: string | null;
  sourceEid: string;
  onshapePartId: string;
  onshapeName: string;
};

export type MergePlan = {
  insert: BomRow[];
  update: {
    id: string;
    changes: PartChanges; // Onshape fields, applied with via "sync"
    identity: IdentityUpdate; // always refreshed (workspace/version id may change)
    onshapeMaterial: string | null;
    restore: boolean; // was removed from CAD, now back
    relinked: boolean;
  }[];
  remove: string[]; // part ids to mark removed_from_cad_at
};

function identity(row: BomRow): IdentityUpdate {
  return {
    sourceDid: row.sourceDid,
    sourceWid: row.sourceWid,
    sourceWvm: row.sourceWvm,
    sourceEid: row.sourceEid,
    onshapePartId: row.onshapePartId,
    onshapeName: row.onshapeName,
  };
}

export function planMerge(existing: ExistingPart[], bom: BomRow[]): MergePlan {
  const synced = existing.filter((p) => !p.isManual);
  const byKey = new Map(synced.map((p) => [partKey(p), p]));
  const matched = new Set<string>();
  const plan: MergePlan = { insert: [], update: [], remove: [] };
  const unmatchedRows: BomRow[] = [];

  const queueUpdate = (part: ExistingPart, row: BomRow, relinked: boolean) => {
    matched.add(part.id);
    const changes: PartChanges = {};
    for (const field of ONSHAPE_FIELDS) {
      if (part.overriddenFields.includes(field)) continue;
      if (part[field] !== row[field]) Object.assign(changes, { [field]: row[field] });
    }
    plan.update.push({
      id: part.id,
      changes,
      identity: identity(row),
      onshapeMaterial: row.onshapeMaterial,
      restore: part.removedFromCadAt !== null,
      relinked,
    });
  };

  for (const row of bom) {
    const part = byKey.get(partKey(row));
    if (part && !matched.has(part.id)) queueUpdate(part, row, false);
    else unmatchedRows.push(row);
  }

  // Re-keyed parts: same Onshape name, identity changed. Prefer parts still on the board,
  // then parts already marked removed.
  for (const row of unmatchedRows) {
    const candidates = synced
      .filter((p) => !matched.has(p.id) && p.onshapeName === row.onshapeName)
      .sort((a, b) => Number(a.removedFromCadAt !== null) - Number(b.removedFromCadAt !== null));
    if (candidates[0]) queueUpdate(candidates[0], row, true);
    else plan.insert.push(row);
  }

  for (const p of synced) {
    if (!matched.has(p.id) && p.removedFromCadAt === null) plan.remove.push(p.id);
  }
  return plan;
}
