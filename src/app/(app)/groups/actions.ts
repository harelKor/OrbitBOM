"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PRIORITIES } from "@/config/priorities";
import { STATUSES } from "@/config/statuses";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { analyseMissing } from "@/lib/groups/missing";
import { applyPartChanges } from "@/lib/parts/apply";
import { deleteObjects, fileKeysForGroup } from "@/lib/storage/cleanup";
import { isUuid } from "@/lib/uuid";

const { partGroups, groupMembers, parts, systems } = schema;

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
  await requireMember();
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
  await requireMember();
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
  await requireMember();
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
});

export async function updateGroup(groupId: string, details: unknown): Promise<ActionResult> {
  await requireMember();
  if (!isUuid(groupId)) return { error: "Unknown group." };
  const parsed = groupDetails.safeParse(details);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await db.update(partGroups).set(parsed.data).where(eq(partGroups.id, groupId));
  refresh();
  return {};
}

export async function deleteGroup(groupId: string) {
  await requireMember();
  if (!isUuid(groupId)) return;
  const keys = await fileKeysForGroup(groupId);
  await db.delete(partGroups).where(eq(partGroups.id, groupId));
  await deleteObjects(keys);
  refresh();
}

const statusNames = STATUSES.map((s) => s.name) as string[];

// "Set status for all": every member still on the BOM, in one history batch.
export async function setGroupStatus(groupId: string, status: string): Promise<ActionResult> {
  const member = await requireMember();
  if (!isUuid(groupId) || !statusNames.includes(status)) return { error: "Unknown status." };
  const rows = await db
    .select({ id: parts.id })
    .from(groupMembers)
    .innerJoin(parts, eq(parts.id, groupMembers.partId))
    .where(and(eq(groupMembers.groupId, groupId), isNull(parts.removedFromCadAt)));
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
  await requireMember();
  if (!isUuid(groupId)) return { error: "Unknown group." };
  const rows = await db
    .select({ part: parts, systemName: systems.name })
    .from(groupMembers)
    .innerJoin(parts, eq(parts.id, groupMembers.partId))
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .where(eq(groupMembers.groupId, groupId));
  const systemIds = [...new Set(rows.filter((r) => r.part.removedFromCadAt).map((r) => r.part.systemId))];
  if (!systemIds.length) return { message: "Every member is on the BOM." };
  const live = await db
    .select()
    .from(parts)
    .where(and(inArray(parts.systemId, systemIds), isNull(parts.removedFromCadAt)));
  const report = analyseMissing(
    rows.map((r) => ({
      partId: r.part.id,
      name: r.part.onshapeName ?? r.part.displayName ?? "",
      systemId: r.part.systemId,
      systemName: r.systemName,
      removedFromCadAt: r.part.removedFromCadAt,
    })),
    live.map((p) => ({ id: p.id, name: p.onshapeName ?? p.displayName ?? "", systemId: p.systemId })),
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
