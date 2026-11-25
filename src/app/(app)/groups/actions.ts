"use server";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { areaOfMachine, getMachine } from "@/config/machines";
import { PRIORITIES } from "@/config/priorities";
import { IN_PROCESS_LATER, RELEASED_LATER, STATUSES, processStatusOf, type StatusName } from "@/config/statuses";
import { db, schema } from "@/db";
import { requireCapability, statusChangeDenied } from "@/lib/mode";
import { READY_STATUS, READY_STATUSES, fabBatchName, fabBatchRefusal, fabStage, stockOf } from "@/lib/fab";
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

// The layout window's face choice (Flip, or a face clicked in its 3D preview): the part's copies
// lie on that face in the layout, in Onshape Layout and in the batch's DXFs. `down` is the
// face's outward normal in Part Studio axes; null goes back to the automatic choice.
export async function setPartFace(groupId: string, partId: string, down: [number, number, number] | null): Promise<ActionResult> {
  await requireCapability("work");
  if (!isUuid(groupId) || !isUuid(partId)) return { error: "Unknown part." };
  const parsed = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).nullable().safeParse(down);
  if (!parsed.success) return { error: "Unknown face." };
  const n = parsed.data && Math.hypot(...parsed.data);
  if (parsed.data && !(n! > 0.5 && n! < 1.5)) return { error: "Unknown face." };
  const face = parsed.data && (parsed.data.map((x) => Math.round((x / n!) * 1e6) / 1e6) as [number, number, number]);
  const [member] = await db.select({ id: groupMembers.partId }).from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.partId, partId)));
  if (!member) return { error: "That part isn't in this batch." };
  const faces = sql`coalesce(${partGroups.layoutData} -> 'faces', '{}'::jsonb)`;
  await db
    .update(partGroups)
    .set({
      layoutData: face
        ? sql`coalesce(${partGroups.layoutData}, '{}'::jsonb) || jsonb_build_object('faces', ${faces} || jsonb_build_object(${partId}::text, ${JSON.stringify(face)}::jsonb))`
        : sql`coalesce(${partGroups.layoutData}, '{}'::jsonb) || jsonb_build_object('faces', ${faces} - ${partId}::text)`,
    })
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

// Released P2+ / In Process 2+ are each part's own numbered status, not one for a whole group.
const statusNames = STATUSES.map((s) => s.name).filter((s) => !processStatusOf(s)) as string[];
// A batch's status as To Fab shows it may be grouped (a CNC batch is "Released P2+"): each part
// takes it at the process it is at (`atProcess`, statusAtProcess), so Released and In Process 1
// stand for them here (audit 2026-11-25, FAB-2).
const plainStatus = (s: string): StatusName | null =>
  s === RELEASED_LATER ? READY_STATUS : s === IN_PROCESS_LATER ? "In Process 1" : statusNames.includes(s) ? (s as StatusName) : null;
// Why a Shop Fab part can't be batched as it is now (audit 2026-11-25, FAB-3): a batch starts from
// parts waiting under Released; parts already in process may move between batches; finished parts
// and parts not released yet stay out.
function notBatchable(list: (typeof parts.$inferSelect)[], inProcessToo: boolean): string | null {
  const off = list.find((p) => {
    const stage = fabStage(p);
    return stage !== "ready" && !(inProcessToo && stage === "inProcess");
  });
  if (!off) return null;
  const name = off.displayName ?? off.onshapeName ?? "A part";
  return inProcessToo ? `${name} is finished or not released yet: it can't join a batch.` : `${name} isn't waiting under Released: only Released parts start a batch.`;
}

// "Set status for all": every member still on the BOM, in one history batch.
export async function setGroupStatus(groupId: string, status: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  const plain = plainStatus(status);
  if (!isUuid(groupId) || !plain) return { error: "Unknown status." };
  const rows = await db
    .select({ id: parts.id })
    .from(groupMembers)
    .innerJoin(parts, eq(parts.id, groupMembers.partId))
    .where(and(eq(groupMembers.groupId, groupId), isNull(parts.removedFromCadAt)));
  const denied = await statusChangeDenied(rows.map((r) => r.id), { status: plain });
  if (denied) return { error: denied };
  const { changed } = await applyPartChanges(
    rows.map((r) => r.id),
    { status: plain, atProcess: true },
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
// and the day ("Laser 21/10"). Every part must be at that machine now and have a material; parts of
// several stocks make one batch each.
// The batch waits in Ready to Fab (its parts in Released, or Reproduction) unless `status` puts it
// elsewhere, and is marked as made by whoever created it.
export async function createFabBatch(
  robotId: string,
  partIds: string[],
  machineId: string,
  picked?: string,
  customName?: string,
): Promise<ActionResult> {
  const status = picked ? plainStatus(picked) : undefined;
  if (status === null) return { error: "Unknown status." };
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
  // Parts of several stocks make one batch per stock (Harel, 2026-11-20: a batch is one stock).
  const area = !!areaOfMachine(machine.id);
  const byStock = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = area ? "" : (stockOf(r.part) ?? "");
    byStock.set(k, [...(byStock.get(k) ?? []), r]);
  }
  for (const list of byStock.values()) {
    const refused = fabBatchRefusal(machine, list.map(({ part }) => part)) ?? (area ? null : notBatchable(list.map(({ part }) => part), !!status));
    if (refused) return { error: refused };
  }

  // A Shop Fab part waiting under Released stays as it is: a part approved at QA for its next
  // process is Released P2+ there and keeps its earlier processes (audit 2026-11-25, FAB-1).
  const move = status ? rows : rows.filter(({ part }) => (area ? !(READY_STATUSES as string[]).includes(computeStatus(part)) : fabStage(part) !== "ready"));
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
    const made: string[] = [];
    for (const list of byStock.values()) {
      let name = base;
      for (let n = 2; names.has(name); n++) name = `${base} (${n})`;
      names.add(name);
      made.push(name);
      const [group] = await tx.insert(partGroups).values({ robotId, name, machine: machine.id, madeBy: area ? null : member.name }).returning({ id: partGroups.id });
      await tx.insert(groupMembers).values(list.map(({ part }) => ({ groupId: group.id, partId: part.id, keySnapshot: snapshot(part) })));
    }
    if (move.length) {
      await applyPartChanges(
        move.map(({ part }) => part.id),
        { status: status ?? READY_STATUS, atProcess: true },
        { memberId: member.id, via: "ui", tx },
      );
    }
    return { made };
  });
  if ("error" in result) return result;
  refresh();
  const count = `${rows.length} part${rows.length === 1 ? "" : "s"}`;
  return { message: result.made.length === 1 ? `Created ${result.made[0]} with ${count}.` : `Created ${result.made.length} batches, one per stock, with ${count}.` };
}

// Dragging cards onto a fab batch on To Fab: they join it (leaving the batch they came from) and
// take its status.
export async function moveToFabBatch(groupId: string, partIds: string[], fromGroupId: string | null, picked: string | null): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(groupId) || (fromGroupId && !isUuid(fromGroupId))) return { error: "Unknown fab." };
  const status = picked ? plainStatus(picked) : null;
  if (picked && !status) return { error: "Unknown status." };
  const [group] = await db.select().from(partGroups).where(eq(partGroups.id, groupId));
  if (!group) return { error: "Unknown fab." };
  const machine = group.machine ? getMachine(group.machine) : null;
  if (!machine) return { error: "That isn't a fab batch." };
  const rows = await robotParts(group.robotId, partIds);
  if (!rows.length) return { error: "Choose parts from this robot." };
  const ids = rows.map((p) => p.id);
  // The same checks as Fab (createFabBatch): each joining part at the batch's machine now, with a
  // material, one stock with the parts already in it, and no part in two fab batches.
  const already = await db
    .select({ part: parts })
    .from(groupMembers)
    .innerJoin(parts, eq(parts.id, groupMembers.partId))
    .where(and(eq(groupMembers.groupId, groupId), isNull(parts.removedFromCadAt)));
  const joining = await db.select().from(parts).where(inArray(parts.id, ids));
  const newcomers = joining.filter((p) => !already.some((r) => r.part.id === p.id));
  const refused =
    fabBatchRefusal(
      machine,
      newcomers,
      already.map((r) => r.part).filter((p) => !ids.includes(p.id)),
    ) ?? (areaOfMachine(machine.id) ? null : notBatchable(newcomers, true));
  if (refused) return { error: refused };
  const denied = status ? await statusChangeDenied(ids, { status }) : null;
  if (denied) return { error: denied };
  // The move and the status change save together, so a failure never leaves parts in the new
  // batch with their old status. The robot is locked like Fab's, so a part can't land in two batches.
  const result = await db.transaction(async (tx) => {
    await tx.select({ id: robots.id }).from(robots).where(eq(robots.id, group.robotId)).for("update");
    const taken = await tx
      .select({ partId: groupMembers.partId, name: partGroups.name })
      .from(groupMembers)
      .innerJoin(partGroups, eq(partGroups.id, groupMembers.groupId))
      .where(
        and(
          inArray(groupMembers.partId, ids),
          isNotNull(partGroups.machine),
          sql`${partGroups.id} not in (${sql.join([groupId, ...(fromGroupId ? [fromGroupId] : [])].map((g) => sql`${g}::uuid`), sql`, `)})`,
        ),
      )
      .limit(1);
    if (taken.length) return { error: `A part you picked is already in ${taken[0].name}. Refresh and pick again.` };
    if (fromGroupId && fromGroupId !== groupId) {
      await tx.delete(groupMembers).where(and(eq(groupMembers.groupId, fromGroupId), inArray(groupMembers.partId, ids)));
    }
    await tx
      .insert(groupMembers)
      .values(rows.map((p) => ({ groupId, partId: p.id, keySnapshot: snapshot(p) })))
      .onConflictDoNothing();
    if (status) await applyPartChanges(ids, { status, atProcess: true }, { memberId: member.id, via: "ui", tx });
    return null;
  });
  if (result) return result;
  refresh();
  return { message: `Added ${rows.length} part${rows.length === 1 ? "" : "s"} to ${group.name}.` };
}
