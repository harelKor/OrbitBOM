import "server-only";
import { and, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PartSnapshot, VersionChange } from "@/db/schema";
import { autoLink } from "@/lib/inventory/autolink";
import { partKey, type BomRow } from "@/lib/onshape/bom";
import { applyBomRows, mvKey } from "@/lib/sync/applyBom";
import type { DraftRows } from "./detect";

const { parts, partVersions, systems, systemVersions } = schema;

export class VersionError extends Error {}

type PartLike = Omit<PartSnapshot, "onshapeMaterial" | "mv"> & { geometry: { onshapeMaterial?: string } | null; onshapeMv: string | null };

const snapshotOfPart = (p: PartLike): PartSnapshot => ({
  sourceDid: p.sourceDid,
  sourceWid: p.sourceWid,
  sourceWvm: p.sourceWvm,
  sourceEid: p.sourceEid,
  onshapePartId: p.onshapePartId,
  onshapeName: p.onshapeName,
  partNumber: p.partNumber,
  description: p.description,
  material: p.material,
  onshapeMaterial: p.geometry?.onshapeMaterial ?? null,
  quantity: p.quantity,
  preProcess: p.preProcess,
  process1: p.process1,
  process2: p.process2,
  mv: p.onshapeMv,
});

const snapshotOfRow = (r: BomRow, mv: string | null): PartSnapshot => ({
  sourceDid: r.sourceDid,
  sourceWid: r.sourceWid,
  sourceWvm: r.sourceWvm,
  sourceEid: r.sourceEid,
  onshapePartId: r.onshapePartId,
  onshapeName: r.onshapeName,
  partNumber: r.partNumber,
  description: r.description,
  material: r.material,
  onshapeMaterial: r.onshapeMaterial,
  quantity: r.quantity,
  preProcess: r.preProcess,
  process1: r.process1,
  process2: r.process2,
  mv,
});

export type CommitResult = {
  versionId: string;
  seq: number;
  added: string[];
  updated: number;
  removed: string[];
  unknownMachines: string[];
};

// Commit changes (plan/system-versioning.md §6): applies the system's draft to its BOM as it
// was shown (`seen` is the draft's detectedAt; a newer check makes the member look again) and
// turns it into the system's next version. A system's first commit also records every part it
// had before as version 0, the baseline. The version's id is the history batch of its edits.
export async function commitDraft(
  systemId: string,
  memberId: string,
  { draftId, seen, name }: { draftId: string; seen?: string; name?: string | null },
): Promise<CommitResult> {
  const result = await db.transaction(async (tx) => {
    const [system] = await tx.select().from(systems).where(eq(systems.id, systemId)).for("update");
    if (!system) throw new VersionError("System not found.");
    const [draft] = await tx
      .select()
      .from(systemVersions)
      .where(and(eq(systemVersions.id, draftId), eq(systemVersions.systemId, systemId), eq(systemVersions.state, "draft")));
    if (!draft) throw new VersionError("These changes were already committed or replaced. Check for changes again.");
    if (seen && draft.detectedAt.toISOString() !== seen) throw new VersionError("Onshape changed again since this list was made. Review the new list.");
    const rows = draft.rows as DraftRows;
    const now = new Date();

    // The baseline: the parts as they were before versioning, so the first version has a Before.
    const [{ last }] = await tx.select({ last: max(systemVersions.seq) }).from(systemVersions).where(eq(systemVersions.systemId, systemId));
    let seq = (last ?? 0) + 1;
    if (last === null) {
      const before = await tx
        .select()
        .from(parts)
        .where(and(eq(parts.systemId, systemId), eq(parts.isManual, false), isNull(parts.removedFromCadAt)));
      if (before.length) {
        const [baseline] = await tx
          .insert(systemVersions)
          .values({ systemId, state: "committed", seq: 0, name: "Baseline", detectedAt: now, committedAt: now, committedBy: memberId })
          .returning({ id: systemVersions.id });
        await pointAt(tx, await tx
          .insert(partVersions)
          .values(before.map((p) => ({ versionId: baseline.id, partId: p.id, change: "baseline" as const, snapshot: snapshotOfPart(p) })))
          .returning({ id: partVersions.id, partId: partVersions.partId }));
      } else seq = 1;
    }

    const applied = await applyBomRows(tx, systemId, rows.bom, { memberId, batchId: draft.id, mvs: rows.mvs });

    // Each listed part's new state, and the part pointing at it.
    const rowByKey = new Map(rows.bom.map((r) => [partKey(r), r]));
    const changes: VersionChange[] = draft.changes.map((c) => ({ ...c, partId: c.partId ?? applied.idByRow.get(c.key) ?? null }));
    const removedIds = changes.filter((c) => c.change === "removed" && c.partId).map((c) => c.partId!);
    const removedParts = removedIds.length ? await tx.select().from(parts).where(inArray(parts.id, removedIds)) : [];
    const values = changes.flatMap((c) => {
      if (!c.partId) return [];
      const row = rowByKey.get(c.key);
      const removed = removedParts.find((p) => p.id === c.partId);
      const snapshot = c.change !== "removed" && row ? snapshotOfRow(row, rows.mvs[mvKey(row)] ?? null) : removed && snapshotOfPart(removed);
      return snapshot ? [{ versionId: draft.id, partId: c.partId, change: c.change, snapshot }] : [];
    });
    if (values.length) await pointAt(tx, await tx.insert(partVersions).values(values).returning({ id: partVersions.id, partId: partVersions.partId }));

    await tx
      .update(systemVersions)
      .set({ state: "committed", seq, name: name?.trim() || draft.name || null, changes, rows: null, committedAt: now, committedBy: memberId })
      .where(eq(systemVersions.id, draft.id));
    const mv = draft.onshapeRef?.mv;
    await tx
      .update(systems)
      .set({
        currentVersionId: draft.id,
        lastSyncedAt: now,
        lastCheckedAt: now,
        ...(mv && draft.onshapeRef ? { docMicroversions: sql`${systems.docMicroversions} || ${JSON.stringify({ [draft.onshapeRef.did]: mv })}::jsonb` } : {}),
      })
      .where(eq(systems.id, systemId));
    return { versionId: draft.id, seq, added: applied.added, updated: applied.updated, removed: applied.removed, unknownMachines: rows.unknownMachines, newIds: applied.newIds };
  });

  // A new part that is an Onshape library part (or product) the inventory knows is linked to
  // its item, and waits in To Review.
  const { newIds, ...out } = result;
  await autoLink({ partIds: newIds }, { memberId, via: "sync" });
  return out;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function pointAt(tx: Tx, rows: { id: string; partId: string }[]) {
  for (const r of rows) await tx.update(parts).set({ versionRowId: r.id }).where(eq(parts.id, r.partId));
}
