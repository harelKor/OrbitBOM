"use server";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getMachine } from "@/config/machines";
import { PRIORITIES } from "@/config/priorities";
import { STATUSES, type StatusName } from "@/config/statuses";
import { db, schema } from "@/db";
import { requireCapability, statusChangeDenied } from "@/lib/mode";
import { READY_STATUS, READY_STATUSES, fabBatchName, machinesOf } from "@/lib/fab";
import { analyseMissing } from "@/lib/groups/missing";
import { applyPartChanges } from "@/lib/parts/apply";
import { computeStatus } from "@/lib/status";
import { deleteObjects, fileKeysForGroup } from "@/lib/storage/cleanup";
import { isUuid } from "@/lib/uuid";

const { partGroups, groupMembers, parts, robots, systems } = schema;

export type ActionResult = { error?: string; message?: string };

function refresh() {
  revalidatePath("/robots", "layout");
}

// The robot's parts among `partIds`, with the identity kept for Why? and Recover.
async function robotParts(robotId: string, partIds: string[]) {
  if (!partIds.length || partIds.some((id) => !isUuid(id))) return [];
  return db
    .select({
      id: parts.id,
      sourceDid: parts.sourceDid,
      sourceEid: parts.sourceEid,
      onshapePartId: parts.onshapePartId,
      onshapeName: parts.onshapeName,
      displayName: parts.displayName,
    })
    .from(parts)
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .where(and(inArray(parts.id, partIds), eq(systems.robotId, robotId)));
}

const snapshot = (p: Awaited<ReturnType<typeof robotParts>>[number]) => ({
  did: p.sourceDid,
  eid: p.sourceEid,
  partId: p.onshapePartId,
  name: p.onshapeName ?? p.displayName,
});

const COLOR = /^#[0-9a-f]{6}$/i;

// "Group parts" (ref §3): a new group needs two or more parts.
export async function createGroup(robotId: string, name: string, color: string, partIds: string[]): Promise<ActionResult> {
  await requireCapability("work");
  if (!isUuid(robotId)) return { error: "Unknown robot." };
  if (!name.trim()) return { error: "Give the group a name." };
  const rows = await robotParts(robotId, partIds);
  if (rows.length < 2) return { error: "A new group needs two or more parts." };
  await db.transaction(async (tx) => {
    const [group] = await tx
      .insert(partGroups)
      .values({ robotId, name: name.trim(), color: COLOR.test(color) ? color : null })
      .returning({ id: partGroups.id });
    await tx.insert(groupMembers).values(rows.map((p) => ({ groupId: group.id, partId: p.id, keySnapshot: snapshot(p) })));
  });
  refresh();
  return { message: `Grouped ${rows.length} parts as "${name.trim()}".` };
}

export async function addToGroup(groupId: string, partIds: string[]): Promise<ActionResult> {
  await requireCapability("work");
  if (!isUuid(groupId)) return { error: "Unknown group." };
  const [group] = await db.select().from(partGroups).where(eq(partGroups.id, groupId));
  if (!group) return { error: "Unknown group." };
  const rows = await robotParts(group.robotId, partIds);
  if (!rows.length) return { error: "Choose parts from this robot." };
  await db
    .insert(groupMembers)
    .values(rows.map((p) => ({ groupId, partId: p.id, keySnapshot: snapshot(p) })))
    .onConflictDoNothing();
  refresh();
  return { message: `Added ${rows.length} parts to "${group.name}".` };
}

export async function removeFromGroup(groupId: string, partId: string) {
  await requireCapability("work");
  if (!isUuid(groupId) || !isUuid(partId)) return;
  await db.delete(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.partId, partId)));
  refresh();
}

const groupDetails = z.object({
  name: z.string().trim().min(1, "Group name is required.").optional(),
  color: z.string().regex(COLOR).nullable().optional(),
  description: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  priority: z.enum(PRIORITIES).optional(),
  madeBy: z.string().trim().min(1).max(200).nullable().optional(),
});

export async function updateGroup(groupId: string, details: unknown): Promise<ActionResult> {
  await requireCapability("work");
  if (!isUuid(groupId)) return { error: "Unknown group." };
  const parsed = groupDetails.safeParse(details);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db.update(partGroups).set(parsed.data).where(eq(partGroups.id, groupId));
  refresh();
  return {};
}

const layoutState = z.object({
  gap: z.number().min(0).max(200),
  margin: z.number().min(0).max(200),
  sheetKey: z.string().max(40),
  placements: z
    .array(z.object({ partId: z.uuid(), copy: z.number().int().min(0).max(10_000), x: z.number().finite(), y: z.number().finite(), rotation: z.number().finite() }))
    .max(5000),
});

// The Auto Layout window's state, kept so reopening it shows the same layout. Merged into
// layout_data, so the batch's Onshape assembly (its `onshape` key) stays.
export async function saveBatchLayout(groupId: string, state: unknown): Promise<ActionResult> {
  await requireCapability("work");
  if (!isUuid(groupId)) return { error: "Unknown batch." };
  const parsed = layoutState.safeParse(state);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db
    .update(partGroups)
    .set({ layoutData: sql`coalesce(${partGroups.layoutData}, '{}'::jsonb) || ${JSON.stringify(parsed.data)}::jsonb` })
    .where(eq(partGroups.id, groupId));
  return {};
}

export async function deleteGroup(groupId: string) {
  await requireCapability("work");
  if (!isUuid(groupId)) return;
  const keys = await fileKeysForGroup(groupId);
  await db.delete(partGroups).where(eq(partGroups.id, groupId));
  await deleteObjects(keys);
  refresh();
}

const statusNames = STATUSES.map((s) => s.name) as string[];

// "Set status for all": every member still on the BOM, in one history batch.
export async function setGroupStatus(groupId: string, status: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(groupId) || !statusNames.includes(status)) return { error: "Unknown status." };
  const rows = await db
    .select({ id: parts.id })
    .from(groupMembers)
    .innerJoin(parts, eq(parts.id, groupMembers.partId))
    .where(and(eq(groupMembers.groupId, groupId), isNull(parts.removedFromCadAt)));
  const denied = await statusChangeDenied(rows.map((r) => r.id), { status });
  if (denied) return { error: denied };
  const { changed } = await applyPartChanges(
    rows.map((r) => r.id),
    { status: status as (typeof STATUSES)[number]["name"] },
    { memberId: member.id, via: "ui" },
  );
  refresh();
  return { message: `${changed} parts set to ${status}.` };
}

// "Recover": re-link missing members to the live part with the same name in their system.
export async function recoverMembers(groupId: string): Promise<ActionResult> {
  await requireCapability("work");
  if (!isUuid(groupId)) return { error: "Unknown group." };
  const rows = await db
    .select({ part: parts, systemName: systems.name })
    .from(groupMembers)
    .innerJoin(parts, eq(parts.id, groupMembers.partId))
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .where(eq(groupMembers.groupId, groupId));
  const systemIds = [...new Set(rows.filter((r) => r.part.removedFromCadAt).map((r) => r.part.systemId!))];
  if (!systemIds.length) return { message: "Every member is on the BOM." };
  const live = await db
    .select()
    .from(parts)
    .where(and(inArray(parts.systemId, systemIds), isNull(parts.removedFromCadAt)));
  const report = analyseMissing(
    rows.map((r) => ({
      partId: r.part.id,
      name: r.part.onshapeName ?? r.part.displayName ?? "",
      systemId: r.part.systemId!,
      systemName: r.systemName,
      removedFromCadAt: r.part.removedFromCadAt,
    })),
    live.map((p) => ({ id: p.id, name: p.onshapeName ?? p.displayName ?? "", systemId: p.systemId! })),
    new Set(rows.map((r) => r.part.id)),
  );
  const moves = report.missing.filter((m) => m.recoverTo);
  await db.transaction(async (tx) => {
    for (const m of moves) {
      const target = live.find((p) => p.id === m.recoverTo)!;
      await tx
        .update(groupMembers)
        .set({
          partId: target.id,
          keySnapshot: {
            did: target.sourceDid,
            eid: target.sourceEid,
            partId: target.onshapePartId,
            name: target.onshapeName ?? target.displayName,
          },
        })
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.partId, m.partId)));
    }
  });
  refresh();
  const left = report.missing.length - moves.length;
  return {
    message: `Re-linked ${moves.length} part${moves.length === 1 ? "" : "s"}.${left ? ` ${left} could not be matched by name.` : ""}`,
  };
}

// To Fab's Fab button: the selected parts become a batch on one machine, named after the machine
// and the day ("Laser 21/10"). Every part must go through that machine and share one material.
// The batch waits in Ready to Fab (its parts in Released, or Reproduction) unless `status` puts it
// elsewhere, and is marked as made by whoever created it.
export async function createFabBatch(
  robotId: string,
  partIds: string[],
  machineId: string,
  status?: StatusName,
  customName?: string,
): Promise<ActionResult> {
  if (status && !statusNames.includes(status)) return { error: "Unknown status." };
  const member = await requireCapability("work");
  if (!isUuid(robotId)) return { error: "Unknown robot." };
  const machine = getMachine(machineId);
  if (!machine) return { error: "Pick the machine for this fab." };
  if (!partIds.length || partIds.some((id) => !isUuid(id))) return { error: "Pick parts to batch." };
  const rows = await db
    .select({ part: parts })
    .from(parts)
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .where(and(inArray(parts.id, partIds), eq(systems.robotId, robotId)));
  if (!rows.length) return { error: "Pick parts to batch." };
  if (rows.some(({ part }) => !machinesOf(part).includes(machine.id))) return { error: `Every part in the fab must go through ${machine.name}.` };
  if (new Set(rows.map(({ part }) => part.material ?? "")).size > 1) return { error: "A fab can only hold parts of one material." };

  const move = status ? rows : rows.filter(({ part }) => !(READY_STATUSES as string[]).includes(computeStatus(part)));
  const denied = move.length ? await statusChangeDenied(move.map(({ part }) => part.id), { status: status ?? READY_STATUS }) : null;
  if (denied) return { error: denied };

  // The name typed in the Fab bar, else "<machine> D/M".
  const base = customName?.trim().slice(0, 80) || fabBatchName(machine.name);

  // One transaction: the batch, its parts and their status save together. The robot is locked so
  // two members pressing Fab at once get "Laser 03/11" and "Laser 03/11 (2)", and a part already
  // in another fab batch (someone just batched it) is refused rather than put in two.
  const result = await db.transaction(async (tx) => {
    await tx.select({ id: robots.id }).from(robots).where(eq(robots.id, robotId)).for("update");
    const taken = await tx
      .select({ partId: groupMembers.partId, name: partGroups.name })
      .from(groupMembers)
      .innerJoin(partGroups, eq(partGroups.id, groupMembers.groupId))
      .where(and(inArray(groupMembers.partId, rows.map(({ part }) => part.id)), isNotNull(partGroups.machine)))
      .limit(1);
    if (taken.length) return { error: `A part you picked is already in ${taken[0].name}. Refresh and pick again.` };
    const names = new Set((await tx.select({ name: partGroups.name }).from(partGroups).where(eq(partGroups.robotId, robotId))).map((g) => g.name));
    let name = base;
    for (let n = 2; names.has(name); n++) name = `${base} (${n})`;
    const [group] = await tx.insert(partGroups).values({ robotId, name, machine: machine.id, madeBy: member.name }).returning({ id: partGroups.id });
    await tx.insert(groupMembers).values(rows.map(({ part }) => ({ groupId: group.id, partId: part.id, keySnapshot: snapshot(part) })));
    if (move.length) {
      await applyPartChanges(
        move.map(({ part }) => part.id),
        { status: status ?? READY_STATUS },
        { memberId: member.id, via: "ui", tx },
      );
    }
    return { name };
  });
  if ("error" in result) return result;
  refresh();
  return { message: `Created ${result.name} with ${rows.length} part${rows.length === 1 ? "" : "s"}.` };
}

// Dragging cards onto a fab batch on To Fab: they join it (leaving the batch they came from) and
// take its status.
export async function moveToFabBatch(groupId: string, partIds: string[], fromGroupId: string | null, status: StatusName | null): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(groupId) || (fromGroupId && !isUuid(fromGroupId))) return { error: "Unknown fab." };
  if (status && !statusNames.includes(status)) return { error: "Unknown status." };
  const [group] = await db.select().from(partGroups).where(eq(partGroups.id, groupId));
  if (!group) return { error: "Unknown fab." };
  const rows = await robotParts(group.robotId, partIds);
  if (!rows.length) return { error: "Choose parts from this robot." };
  const ids = rows.map((p) => p.id);
  const denied = status ? await statusChangeDenied(ids, { status }) : null;
  if (denied) return { error: denied };
  // The move and the status change save together, so a failure never leaves parts in the new
  // batch with their old status.
  await db.transaction(async (tx) => {
    if (fromGroupId && fromGroupId !== groupId) {
      await tx.delete(groupMembers).where(and(eq(groupMembers.groupId, fromGroupId), inArray(groupMembers.partId, ids)));
    }
    await tx
      .insert(groupMembers)
      .values(rows.map((p) => ({ groupId, partId: p.id, keySnapshot: snapshot(p) })))
      .onConflictDoNothing();
    if (status) await applyPartChanges(ids, { status }, { memberId: member.id, via: "ui", tx });
  });
  refresh();
  return { message: `Added ${rows.length} part${rows.length === 1 ? "" : "s"} to ${group.name}.` };
}
