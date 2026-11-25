"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { REFRESH } from "@/config/refresh";
import { z } from "zod";
import { COTS_PROCESS, MACHINES } from "@/config/machines";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { partChangesCapability } from "@/components/shell/mode";
import { checkCapability, requireCapability, statusChangeDenied } from "@/lib/mode";
import { OnshapeError } from "@/lib/onshape/client";
import { MERGE_PREFIX, fanOutChanges, isMergeId, mergedRow } from "@/lib/merges/merge";
import { applyEachPartChanges, applyPartChanges } from "@/lib/parts/apply";
import { partChangesSchema, resolveCounterAdds, type PartChanges } from "@/lib/parts/changes";
import { settleSuggestedLink, suggestPickedParts } from "@/lib/review/review";
import { refreshSystem } from "@/lib/sync/refresh";
import { updateBomFromOnshape } from "@/lib/sync/updateBom";
import { fileKeysFor } from "@/lib/storage/cleanup";
import { deleteToTrash } from "@/lib/trash";
import { CREATED } from "@/lib/parts/undo";
import { currentVisit } from "@/lib/visits";
import { randomUUID } from "node:crypto";
import { isUuid } from "@/lib/uuid";
import { getPart } from "@/lib/data/parts";

export type ActionResult = { error?: string; message?: string };

// A part's details window, opened in place from another page (an inventory item's Used in).
export async function loadPartWindow(partId: string) {
  const member = await requireMember();
  if (!isUuid(partId)) return null;
  const found = await getPart(partId);
  return found && { part: found.part, robotId: found.robotId, isAdmin: member.isAdmin };
}

export async function updatePart(partId: string, changes: unknown): Promise<ActionResult> {
  await requireMember();
  const parsed = partChangesSchema.safeParse(changes);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  // Status, machines, material and counts are any team's; other fields need Edit mode.
  const { member, error } = await checkCapability(partChangesCapability(parsed.data));
  if (error !== undefined) return { error };
  const denied = await statusChangeDenied(isMergeId(partId) ? await expandMerges([partId]) : [partId], parsed.data);
  if (denied) return { error: denied };
  if (isMergeId(partId)) return updateMergedRow(partId.slice(MERGE_PREFIX.length), parsed.data, member.id);
  if (!isUuid(partId)) return { error: "Unknown part." };
  await applyPartChanges([partId], parsed.data, { memberId: member.id, via: "ui" });
  revalidatePath("/robots", "layout");
  return {};
}

// A card's suggested inventory link (the Link tag on its thumbnail): Link takes it off To Review
// (the card links the part itself), ✕ rejects it so it isn't suggested again.
export async function settleLinkSuggestion(partIds: string[], itemId: string, accept: boolean): Promise<ActionResult> {
  const member = await requireCapability("work");
  const ids = partIds.filter(isUuid);
  if (!ids.length || !isUuid(itemId)) return { error: "Unknown part." };
  await settleSuggestedLink(ids, itemId, accept, member.id);
  revalidatePath("/", "layout");
  return {};
}

const machine = z.union([z.literal(""), z.enum(MACHINES.map((m) => m.id) as [string, ...string[]])]);
// Process 1 may be COTS (bought, then QA, then its added processes).
const process1 = z.union([machine, z.literal(COTS_PROCESS)]);

const manualPart = z.object({
  name: z.string().trim().min(1, "Part name is required."),
  quantity: z.coerce.number().int().min(0),
  inventoryItemId: z.union([z.literal(""), z.uuid()]).default(""),
  material: z.string().trim().default(""), // a general material, when no item is picked
  description: z.string().trim().default(""),
  process1,
  process2: machine, // the first added process
  drawingUrl: z.union([z.literal(""), z.url("The drawing link must be a URL.")]),
});

export async function addManualPart(
  systemId: string,
  _: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const member = await requireCapability("shape");
  if (!isUuid(systemId)) return { error: "Unknown system." };
  const parsed = manualPart.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const orNull = (v: string) => v || null;
  // The material is an inventory item (the part keeps its name too), or a general material by name.
  const [item] = d.inventoryItemId
    ? await db.select({ id: schema.inventoryItems.id, name: schema.inventoryItems.name }).from(schema.inventoryItems).where(eq(schema.inventoryItems.id, d.inventoryItemId))
    : [];
  // Recorded like an edit, so it shows in Recent actions and Undo moves it to Recently deleted.
  const visit = await currentVisit();
  await db.transaction(async (tx) => {
  const [part] = await tx.insert(schema.parts).values({
    systemId,
    isManual: true,
    displayName: d.name,
    quantity: d.quantity,
    material: item?.name ?? orNull(d.material),
    inventoryItemId: item?.id ?? null,
    description: orNull(d.description),
    process1: orNull(d.process1),
    addedProcesses: d.process2 ? [{ machine: d.process2, done: 0, qa: false, qaDone: false }] : [],
    drawingUrl: orNull(d.drawingUrl),
    lastModifiedBy: member.id,
  }).returning({ id: schema.parts.id });
    await tx.insert(schema.partHistory).values({ partId: part.id, field: CREATED, oldValue: null, newValue: d.name, memberId: member.id, via: "ui", batchId: randomUUID(), visitId: visit?.id, page: visit?.page });
  });
  revalidatePath("/robots", "layout");
  return {};
}

// Only manual parts can be deleted; Onshape parts come back on the next sync.
// Kept in Recently deleted (Settings) for 30 days.
export async function deleteManualPart(partId: string): Promise<ActionResult> {
  const member = await requireCapability("manage");
  if (!isUuid(partId)) return { error: "Unknown part." };
  const where = and(eq(schema.parts.id, partId), eq(schema.parts.isManual, true))!;
  const [part] = await db.select({ name: schema.parts.displayName, onshapeName: schema.parts.onshapeName }).from(schema.parts).where(where);
  if (part) {
    const fileKeys = await fileKeysFor({ partId });
    const label = part.name ?? part.onshapeName ?? "Manual part";
    await db.transaction((tx) => deleteToTrash(tx, { kind: "part", label, root: schema.parts, where, memberId: member.id, fileKeys }));
  }
  revalidatePath("/robots", "layout");
  revalidatePath("/cots", "layout");
  return {};
}

export type SyncResult = { error?: string; message?: string };

export async function syncSystem(systemId: string): Promise<SyncResult> {
  const member = await requireCapability("sync");
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
    if (s.skipped === "review")
      return {
        error: `Onshape's BOM leaves out ${s.removed.length} of this system's parts, so nothing was applied. Open Update System to check the changes and commit them if they're right.`,
      };
    if (s.skipped) return { message: `BOM is up to date (${s.calls} Onshape calls).` };
    return { message: `BOM updated as ${s.version}: ${parts.join(", ")} (${s.calls} Onshape calls).${warning}` };
  } catch (err) {
    if (err instanceof OnshapeError) return { error: err.message };
    throw err;
  }
}

// Called by an open system page every few minutes: checks Onshape for changes if the system
// is due (one call), on the viewer's account or else the system's refresh account (another
// connected member's when that one can't). New changes wait in the system's draft; `changed`
// tells the page to show them.
export async function refreshIfDue(systemId: string): Promise<{ changed: boolean }> {
  const member = await requireMember();
  if (!REFRESH.openPages || !isUuid(systemId)) return { changed: false };
  const [system] = await db
    .select({ refreshMemberId: schema.systems.refreshMemberId })
    .from(schema.systems)
    .where(eq(schema.systems.id, systemId));
  if (!system) return { changed: false };
  const accountId = member.onshapeConnected ? member.id : system.refreshMemberId;
  const r = await refreshSystem(systemId, accountId, Date.now() + 45_000);
  if (r?.changed) revalidatePath("/robots", "layout");
  return { changed: !!r?.changed };
}

// Bulk edit and Kanban moves: the same changes on many parts, one history batch.
export async function updateParts(ids: string[], changes: unknown): Promise<ActionResult> {
  await requireMember();
  const partIds = await expandMerges(ids);
  if (!partIds.length || partIds.some((id) => !isUuid(id))) return { error: "Unknown part." };
  const parsed = partChangesSchema.safeParse(changes);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { member, error } = await checkCapability(partChangesCapability(parsed.data));
  if (error !== undefined) return { error };
  const denied = await statusChangeDenied(partIds, parsed.data);
  if (denied) return { error: denied };
  await applyPartChanges(partIds, parsed.data, { memberId: member.id, via: "ui" });
  revalidatePath("/robots", "layout");
  return {};
}

// The system page's Suggest mode: fresh setup suggestions plus auto-link on the picked parts
// (set up or not), each waiting in To Review for Approve or Reject.
export async function suggestParts(ids: string[]): Promise<ActionResult> {
  const member = await requireCapability("review");
  const partIds = [...new Set(await expandMerges(ids))];
  if (!partIds.length || partIds.some((id) => !isUuid(id))) return { error: "Unknown part." };
  const { checked, suggested, linked, blind } = await suggestPickedParts(partIds, member.id);
  revalidatePath("/robots", "layout");
  // Parts with nothing to read need the robot's 3D model (Harel, 2026-11-06).
  const needModel = blind
    ? ` ${blind} part${blind === 1 ? " has" : "s have"} no Onshape material or 3D measurement: press Update 3D model on the robot page, then Suggest again.`
    : "";
  if (!suggested && !linked) return { message: `Nothing new to suggest for ${checked === 1 ? "this part" : `these ${checked} parts`}.${needModel}` };
  return {
    message:
      `Suggested a new setup for ${suggested} of ${checked} part${checked === 1 ? "" : "s"}.` +
      (linked ? ` ${linked} inventory ${linked === 1 ? "link" : "links"} to approve.` : "") +
      " They wait in To Review for Approve or Reject." +
      needModel,
  };
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
  // A counted piece on a merged row (Process 1 or an added process) is added to the members' saved
  // counts once, then spread over them; sent as is, each member took the piece (BOM-5).
  if (changes.add || changes.addAt) {
    const rows = await db.select().from(schema.parts).where(inArray(schema.parts.id, members.map((m) => m.id)));
    const ordered = members.map((m) => rows.find((r) => r.id === m.id)!).filter(Boolean);
    changes = resolveCounterAdds(mergedRow({ id: mergeId, name: "" }, ordered), changes);
  }
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
  await requireCapability("shape");
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
  await requireCapability("shape");
  const mergeId = mergeRowId.replace(MERGE_PREFIX, "");
  if (!isUuid(mergeId)) return { error: "Unknown merged part." };
  await db.delete(schema.merges).where(eq(schema.merges.id, mergeId));
  revalidatePath("/robots", "layout");
  return {};
}
