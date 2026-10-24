import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { partKey, type BomRow } from "@/lib/onshape/bom";
import { planPartUpdate } from "@/lib/parts/changes";
import { planMerge } from "./merge";

const { parts, partHistory } = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type BomApplied = {
  added: string[];
  updated: number;
  removed: string[];
  relinked: string[];
  restored: string[];
  newIds: string[];
  // Each row's part: partKey(row) → part id, for inserted and matched parts alike.
  idByRow: Map<string, string>;
  removedIds: string[];
};

// A part's shape fingerprint is looked up by Part Studio + partId (its name can change).
export const sigKey = (p: { sourceDid: string | null; sourceEid: string | null; onshapePartId: string | null }) =>
  `${p.sourceDid}|${p.sourceEid}|${p.onshapePartId}`;

// Merges BOM rows into a system's parts (Update BOM's merge rules, plan §4) inside the caller's
// transaction: inserts new parts, refreshes Onshape fields and identity, hides parts missing
// from the BOM. `sigs` gives each part's shape fingerprint (by sigKey) to keep as committed;
// `partSigs` the committed shape (by part id) of parts that had none stored yet. With `only`
// (partKeys), just those parts are inserted, updated or hidden; parts in `skip` (ids) are left
// as they are.
export async function applyBomRows(
  tx: Tx,
  systemId: string,
  rows: BomRow[],
  {
    memberId,
    batchId,
    sigs = {},
    partSigs = {},
    only,
    skip,
  }: {
    memberId: string;
    batchId: string;
    sigs?: Record<string, string>;
    partSigs?: Record<string, string>;
    only?: Set<string>;
    skip?: Set<string>;
  },
): Promise<BomApplied> {
  const rowsNow = await tx.select().from(parts).where(eq(parts.systemId, systemId)).for("update");
  const existing = rowsNow.map((p) => ({ ...p, shapeSig: p.shapeSig ?? partSigs[p.id] ?? null }));
  const plan = planMerge(existing, rows, (r) => sigs[sigKey(r)]);
  const byId = new Map(existing.map((p) => [p.id, p]));
  if (only) {
    plan.insert = plan.insert.filter((r) => only.has(partKey(r)));
    plan.update = plan.update.filter((u) => only.has(partKey(u.identity)));
    plan.remove = plan.remove.filter((id) => only.has(partKey(byId.get(id)!)));
  }
  if (skip?.size) {
    plan.update = plan.update.filter((u) => !skip.has(u.id));
    plan.remove = plan.remove.filter((id) => !skip.has(id));
  }
  const now = new Date();
  const result: BomApplied = {
    added: plan.insert.map((r) => r.onshapeName),
    updated: 0,
    removed: plan.remove.map((id) => byId.get(id)?.onshapeName ?? id),
    relinked: [],
    restored: [],
    newIds: [],
    idByRow: new Map(),
    removedIds: plan.remove,
  };

  if (plan.insert.length) {
    const inserted = await tx
      .insert(parts)
      .values(
        plan.insert.map((r) => ({
          systemId,
          sourceDid: r.sourceDid,
          sourceWid: r.sourceWid,
          sourceWvm: r.sourceWvm,
          sourceEid: r.sourceEid,
          onshapePartId: r.onshapePartId,
          onshapeName: r.onshapeName,
          partNumber: r.partNumber,
          description: r.description,
          material: r.material,
          quantity: r.quantity,
          preProcess: r.preProcess,
          process1: r.process1,
          process2: r.process2,
          // A part with a process is made in-house; without one nobody has said yet (Undefined).
          classification: r.preProcess || r.process1 || r.process2 ? ("inhouse" as const) : ("undefined" as const),
          geometry: r.onshapeMaterial ? { onshapeMaterial: r.onshapeMaterial } : null,
          shapeSig: sigs[sigKey(r)] ?? null,
          lastModifiedBy: memberId,
        })),
      )
      .returning({ id: parts.id });
    inserted.forEach((p, i) => {
      result.newIds.push(p.id);
      result.idByRow.set(partKey(plan.insert[i]), p.id);
    });
  }

  for (const u of plan.update) {
    const part = byId.get(u.id)!;
    const { set, history } = planPartUpdate(part, u.changes, "sync");
    if (history.length) result.updated++;
    if (u.relinked) result.relinked.push(u.identity.onshapeName);
    if (u.restore) result.restored.push(u.identity.onshapeName);
    result.idByRow.set(partKey(u.identity), u.id);
    const sig = sigs[sigKey(u.identity)];
    await tx
      .update(parts)
      .set({
        ...set,
        ...u.identity,
        geometry: { ...(part.geometry ?? {}), onshapeMaterial: u.onshapeMaterial ?? undefined },
        removedFromCadAt: null,
        ...(sig ? { shapeSig: sig } : {}),
        ...(history.length ? { lastModifiedAt: now, lastModifiedBy: memberId } : {}),
      })
      .where(eq(parts.id, u.id));
    if (history.length) {
      await tx.insert(partHistory).values(history.map((h) => ({ partId: u.id, ...h, memberId, via: "sync" as const, batchId })));
    }
  }

  for (const id of plan.remove) {
    await tx
      .update(parts)
      .set({ removedFromCadAt: now })
      .where(and(eq(parts.id, id), eq(parts.isManual, false)));
  }
  return result;
}
