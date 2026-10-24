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

// A part's Onshape microversion is looked up by Part Studio + partId (its name can change).
export const mvKey = (p: { sourceDid: string | null; sourceEid: string | null; onshapePartId: string | null }) =>
  `${p.sourceDid}|${p.sourceEid}|${p.onshapePartId}`;

// Merges BOM rows into a system's parts (Update BOM's merge rules, plan §4) inside the caller's
// transaction: inserts new parts, refreshes Onshape fields and identity, hides parts missing
// from the BOM. `mvs` gives each part's Onshape microversion to keep as committed.
export async function applyBomRows(
  tx: Tx,
  systemId: string,
  rows: BomRow[],
  { memberId, batchId, mvs = {} }: { memberId: string; batchId: string; mvs?: Record<string, string> },
): Promise<BomApplied> {
  const existing = await tx.select().from(parts).where(eq(parts.systemId, systemId)).for("update");
  const plan = planMerge(existing, rows);
  const byId = new Map(existing.map((p) => [p.id, p]));
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
          onshapeMv: mvs[mvKey(r)] ?? null,
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
    const mv = mvs[mvKey(u.identity)];
    await tx
      .update(parts)
      .set({
        ...set,
        ...u.identity,
        geometry: { ...(part.geometry ?? {}), onshapeMaterial: u.onshapeMaterial ?? undefined },
        removedFromCadAt: null,
        ...(mv ? { onshapeMv: mv } : {}),
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
