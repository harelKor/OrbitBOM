import "server-only";
import { and, eq } from "drizzle-orm";
import { importSetup } from "@/config/autoSetup";
import { db, schema } from "@/db";
import { partKey, type BomRow } from "@/lib/onshape/bom";
import { planPartUpdate } from "@/lib/parts/changes";
import { moreToMake, planMerge } from "./merge";

const { parts, partHistory, inventoryItems } = schema;

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
    // A new part parseBom set up from its material (a PLA part on the Bambu) is linked to that
    // material's filament item; the item's name stays its material on later syncs.
    const autoOf = (r: BomRow) => {
      const a = importSetup(r.material, r.onshapeMaterial);
      return a && !r.preProcess && r.process1 === a.process1 && !r.process2 ? a : undefined;
    };
    const filament = plan.insert.some(autoOf) ? await filamentItems(tx) : [];
    const inserted = await tx
      .insert(parts)
      .values(
        plan.insert.map((r) => {
          const a = autoOf(r);
          const item = a && filamentFor(a.material, filament);
          return {
          systemId,
          sourceDid: r.sourceDid,
          sourceWid: r.sourceWid,
          sourceWvm: r.sourceWvm,
          sourceEid: r.sourceEid,
          onshapePartId: r.onshapePartId,
          onshapeName: r.onshapeName,
          partNumber: r.partNumber,
          description: r.description,
          material: item?.name ?? r.material,
          inventoryItemId: item?.id ?? null,
          overriddenFields: item ? ["material"] : [],
          quantity: r.quantity,
          preProcess: r.preProcess,
          process1: r.process1,
          process2: r.process2,
          // A part with a process is made in-house; without one nobody has said yet (Undefined).
          classification: r.preProcess || r.process1 || r.process2 ? ("inhouse" as const) : ("undefined" as const),
          geometry: r.onshapeMaterial ? { onshapeMaterial: r.onshapeMaterial } : null,
          shapeSig: sigs[sigKey(r)] ?? null,
          lastModifiedBy: memberId,
          };
        }),
      )
      .returning({ id: parts.id });
    inserted.forEach((p, i) => {
      result.newIds.push(p.id);
      result.idByRow.set(partKey(plan.insert[i]), p.id);
    });
  }

  for (const u of plan.update) {
    const part = byId.get(u.id)!;
    // A finished part whose CAD quantity went up goes back to the shop for the extra pieces.
    const reopen = moreToMake(part, u.changes);
    const { set, history } = planPartUpdate(part, reopen ? { ...u.changes, ...reopen } : u.changes, "sync");
    // A part nobody had typed that now has a process from Onshape (a PLA part on the Bambu) is made in-house.
    if (part.classification === "undefined" && (set.preProcess || set.process1 || set.process2)) {
      set.classification = "inhouse";
      history.push({ field: "classification", oldValue: "undefined", newValue: "inhouse" });
    }
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
        ...(reopen ? { fabFinishedAt: null } : {}),
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

type Filament = { id: string; name: string; material: string };

async function filamentItems(tx: Tx): Promise<Filament[]> {
  const rows = await tx.select({ id: inventoryItems.id, name: inventoryItems.name, specs: inventoryItems.specs }).from(inventoryItems).where(eq(inventoryItems.category, "filament"));
  return rows.map((r) => ({ id: r.id, name: r.name, material: r.specs.material ?? "" }));
}

// The filament item of a material: one named just that ("PLA") first, then one whose material
// spec is it, then one with it in its name.
function filamentFor(material: string, items: Filament[]): Filament | undefined {
  const re = new RegExp(`\\b${material}\\b`, "i");
  const low = material.toLowerCase();
  return (
    items.find((i) => i.name.trim().toLowerCase() === low) ??
    items.find((i) => i.material.toLowerCase() === low) ??
    items.find((i) => re.test(i.name))
  );
}
