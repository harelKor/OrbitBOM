"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MACHINES } from "@/config/machines";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { OnshapeError } from "@/lib/onshape/client";
import { MERGE_PREFIX, fanOutChanges, isMergeId } from "@/lib/merges/merge";
import { applyEachPartChanges, applyPartChanges } from "@/lib/parts/apply";
import { partChangesSchema, type PartChanges } from "@/lib/parts/changes";
import { refreshSystem } from "@/lib/sync/refresh";
import { updateBomFromOnshape } from "@/lib/sync/updateBom";
import { deleteObjects, fileKeysFor } from "@/lib/storage/cleanup";
import { isUuid } from "@/lib/uuid";

export type ActionResult = { error?: string; message?: string };

export async function updatePart(partId: string, changes: unknown): Promise<ActionResult> {
  const member = await requireMember();
  const parsed = partChangesSchema.safeParse(changes);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (isMergeId(partId)) return updateMergedRow(partId.slice(MERGE_PREFIX.length), parsed.data, member.id);
  if (!isUuid(partId)) return { error: "Unknown part." };
  await applyPartChanges([partId], parsed.data, { memberId: member.id, via: "ui" });
  revalidatePath("/robots", "layout");
  return {};
}

const machine = z.union([z.literal(""), z.enum(MACHINES.map((m) => m.id) as [string, ...string[]])]);

const manualPart = z.object({
  name: z.string().trim().min(1, "Part name is required."),
  quantity: z.coerce.number().int().min(0),
  material: z.string().trim(),
  description: z.string().trim(),
  preProcess: machine,
  process1: machine,
  process2: machine,
  drawingUrl: z.union([z.literal(""), z.url("The drawing link must be a URL.")]),
});

export async function addManualPart(
  systemId: string,
  _: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const member = await requireMember();
  const parsed = manualPart.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const orNull = (v: string) => v || null;
  await db.insert(schema.parts).values({
    systemId,
    isManual: true,
    displayName: d.name,
    quantity: d.quantity,
    material: orNull(d.material),
    description: orNull(d.description),
    preProcess: orNull(d.preProcess),
    process1: orNull(d.process1),
    process2: orNull(d.process2),
    drawingUrl: orNull(d.drawingUrl),
    lastModifiedBy: member.id,
  });
  revalidatePath("/robots", "layout");
  return {};
}

// Only manual parts can be deleted; Onshape parts come back on the next sync.
export async function deleteManualPart(partId: string): Promise<ActionResult> {
  await requireMember();
  if (!isUuid(partId)) return { error: "Unknown part." };
  const keys = await fileKeysFor({ partId });
  const deleted = await db
    .delete(schema.parts)
    .where(and(eq(schema.parts.id, partId), eq(schema.parts.isManual, true)))
    .returning({ id: schema.parts.id });
  if (deleted.length) await deleteObjects(keys);
  revalidatePath("/robots", "layout");
  revalidatePath("/cots", "layout");
  return {};
}

export type SyncResult = { error?: string; message?: string };

export async function syncSystem(systemId: string): Promise<SyncResult> {
  const member = await requireMember();
  if (!isUuid(systemId)) return { error: "Unknown system." };
  if (!member.onshapeConnected) return { error: "Connect your Onshape account first (Profile → Connect Onshape)." };
  try {
    const s = await updateBomFromOnshape(systemId, member.id, { force: true });
    // Thumbnails come next, from the button (POST /api/systems/[id]/thumbnails), which has
    // more time than this action.
    revalidatePath("/robots", "layout");
    const parts = [`${s.added.length} added`, `${s.updated} updated`, `${s.removed.length} removed from CAD`];
    const warning = s.unknownMachines.length
      ? ` Unknown machines in Onshape: ${s.unknownMachines.join(", ")}.`
      : "";
    if (s.skipped) return { message: `BOM is up to date (${s.calls} Onshape calls).` };
    return { message: `BOM updated as ${s.version}: ${parts.join(", ")} (${s.calls} Onshape calls).${warning}` };
  } catch (err) {
    if (err instanceof OnshapeError) return { error: err.message };
    throw err;
  }
}

// Called by an open system page every few minutes: checks Onshape for changes if the system
// is due (one call), on the viewer's account or else the system's refresh account. New changes
// wait in the system's draft; `changed` tells the page to show them.
export async function refreshIfDue(systemId: string): Promise<{ changed: boolean }> {
  const member = await requireMember();
  if (!isUuid(systemId)) return { changed: false };
  const [system] = await db
    .select({ refreshMemberId: schema.systems.refreshMemberId })
    .from(schema.systems)
    .where(eq(schema.systems.id, systemId));
  const accountId = member.onshapeConnected ? member.id : system?.refreshMemberId;
  if (!accountId) return { changed: false };
  const r = await refreshSystem(systemId, accountId, Date.now() + 45_000);
  if (r?.changed) revalidatePath("/robots", "layout");
  return { changed: !!r?.changed };
}

// Bulk edit and Kanban moves: the same changes on many parts, one history batch.
export async function updateParts(ids: string[], changes: unknown): Promise<ActionResult> {
  const member = await requireMember();
  const partIds = await expandMerges(ids);
  if (!partIds.length || partIds.some((id) => !isUuid(id))) return { error: "Unknown part." };
  const parsed = partChangesSchema.safeParse(changes);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await applyPartChanges(partIds, parsed.data, { memberId: member.id, via: "ui" });
  revalidatePath("/robots", "layout");
  return {};
}

// ---------- Merge parts (ref §3) ----------

async function mergeMemberRows(mergeId: string) {
  if (!isUuid(mergeId)) return [];
  return db
    .select({ id: schema.parts.id, quantity: schema.parts.quantity })
    .from(schema.mergeMembers)
    .innerJoin(schema.parts, eq(schema.parts.id, schema.mergeMembers.partId))
    .where(eq(schema.mergeMembers.mergeId, mergeId))
    .orderBy(asc(schema.parts.onshapeName), asc(schema.parts.id));
}

// Bulk edits and groups act on a merged row's members.
async function expandMerges(ids: string[]) {
  const out: string[] = [];
  for (const id of ids) {
    if (isMergeId(id)) out.push(...(await mergeMemberRows(id.slice(MERGE_PREFIX.length))).map((m) => m.id));
    else out.push(id);
  }
  return out;
}

async function updateMergedRow(mergeId: string, changes: PartChanges, memberId: string): Promise<ActionResult> {
  const members = await mergeMemberRows(mergeId);
  if (!members.length) return { error: "Unknown merged part." };
  const { rename, perMember } = fanOutChanges(members, changes);
  if (rename !== undefined) {
    if (!rename) return { error: "A merged part needs a name." };
    await db.update(schema.merges).set({ name: rename }).where(eq(schema.merges.id, mergeId));
  }
  await applyEachPartChanges(perMember, { memberId, via: "ui" });
  revalidatePath("/robots", "layout");
  return {};
}

export async function mergeParts(systemId: string, name: string, ids: string[]): Promise<ActionResult> {
  await requireMember();
  if (!isUuid(systemId) || !name.trim()) return { error: "Give the merged part a name." };
  const partIds = await expandMerges(ids);
  if (partIds.length < 2 || partIds.some((id) => !isUuid(id))) return { error: "Pick two or more parts to merge." };
  const rows = await db
    .select({ id: schema.parts.id })
    .from(schema.parts)
    .where(and(inArray(schema.parts.id, partIds), eq(schema.parts.systemId, systemId)));
  if (rows.length !== partIds.length) return { error: "Merge parts from one system." };
  await db.transaction(async (tx) => {
    // Merging merged rows folds them into the new merge.
    const old = await tx
      .delete(schema.mergeMembers)
      .where(inArray(schema.mergeMembers.partId, partIds))
      .returning({ mergeId: schema.mergeMembers.mergeId });
    if (old.length) await tx.delete(schema.merges).where(inArray(schema.merges.id, [...new Set(old.map((o) => o.mergeId))]));
    const [merge] = await tx.insert(schema.merges).values({ systemId, name: name.trim() }).returning({ id: schema.merges.id });
    await tx.insert(schema.mergeMembers).values(partIds.map((partId) => ({ mergeId: merge.id, partId })));
  });
  revalidatePath("/robots", "layout");
  return { message: `Merged ${partIds.length} parts.` };
}

export async function unmergeParts(mergeRowId: string): Promise<ActionResult> {
  await requireMember();
  const mergeId = mergeRowId.replace(MERGE_PREFIX, "");
  if (!isUuid(mergeId)) return { error: "Unknown merged part." };
  await db.delete(schema.merges).where(eq(schema.merges.id, mergeId));
  revalidatePath("/robots", "layout");
  return {};
}
