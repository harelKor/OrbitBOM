import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { analyseMissing, type MissingReport } from "@/lib/groups/missing";
import { computeStatus } from "@/lib/status";
import { statusBreakdown, type Breakdown } from "@/lib/stats";

const { partGroups, groupMembers, groupFiles, parts, systems, robots } = schema;

export type GroupMember = { partId: string; title: string; systemName: string; status: string };

export type GroupSummary = typeof partGroups.$inferSelect & {
  robotName: string;
  members: GroupMember[]; // members still on the BOM
  breakdown: Breakdown;
  missing: MissingReport;
  files: { id: string; type: string; filename: string }[];
};

// The Part Groups page (ref §1, §6): each group with its live members, status counts, files and
// the members that no longer match the BOM.
export async function listGroups(): Promise<GroupSummary[]> {
  const groups = await db
    .select({ group: partGroups, robotName: robots.name })
    .from(partGroups)
    .innerJoin(robots, eq(robots.id, partGroups.robotId))
    .orderBy(asc(robots.name), asc(partGroups.name));
  if (!groups.length) return [];
  const ids = groups.map((g) => g.group.id);
  const [memberRows, files] = await Promise.all([
    db
      .select({ groupId: groupMembers.groupId, part: parts, systemName: systems.name })
      .from(groupMembers)
      .innerJoin(parts, eq(parts.id, groupMembers.partId))
      .innerJoin(systems, eq(systems.id, parts.systemId))
      .where(inArray(groupMembers.groupId, ids)),
    db.select().from(groupFiles).where(inArray(groupFiles.groupId, ids)),
  ]);

  // Live parts in the systems that have missing members, for Why? and Recover.
  const missingSystems = [
    ...new Set(memberRows.filter((m) => m.part.removedFromCadAt).map((m) => m.part.systemId!)),
  ];
  const live = missingSystems.length
    ? await db
        .select({ id: parts.id, name: parts.onshapeName, displayName: parts.displayName, systemId: parts.systemId })
        .from(parts)
        .where(and(inArray(parts.systemId, missingSystems), isNull(parts.removedFromCadAt)))
    : [];

  const nameOf = (p: typeof parts.$inferSelect) => p.displayName ?? p.onshapeName ?? "Unnamed part";
  return groups.map(({ group, robotName }) => {
    const rows = memberRows.filter((m) => m.groupId === group.id);
    const present = rows.filter((m) => !m.part.removedFromCadAt);
    return {
      ...group,
      robotName,
      members: present.map((m) => ({
        partId: m.part.id,
        title: m.part.partNumber ? `${m.part.partNumber} ${nameOf(m.part)}` : nameOf(m.part),
        systemName: m.systemName,
        status: computeStatus(m.part),
      })),
      breakdown: statusBreakdown(present.map((m) => m.part)),
      missing: analyseMissing(
        rows.map((m) => ({
          partId: m.part.id,
          name: m.part.onshapeName ?? nameOf(m.part),
          systemId: m.part.systemId!,
          systemName: m.systemName,
          removedFromCadAt: m.part.removedFromCadAt,
        })),
        live.map((p) => ({ id: p.id, name: p.name ?? p.displayName ?? "", systemId: p.systemId! })),
        new Set(rows.map((m) => m.part.id)),
      ),
      files: files.filter((f) => f.groupId === group.id).map(({ id, type, filename }) => ({ id, type, filename })),
    };
  });
}

// For the BOM's Group parts bar and To Fab's batches: the robot's groups.
export async function listRobotGroups(robotId: string) {
  const [groups, gcodes] = await Promise.all([
    db
      .select({ id: partGroups.id, name: partGroups.name, color: partGroups.color, machine: partGroups.machine, madeBy: partGroups.madeBy, priority: partGroups.priority, onshapeLayoutUrl: sql<string | null>`${partGroups.layoutData} -> 'onshape' ->> 'url'`, createdAt: partGroups.createdAt })
      .from(partGroups)
      .where(eq(partGroups.robotId, robotId))
      .orderBy(asc(partGroups.name)),
    // A fab batch's G-code file, if it has one.
    db
      .select({ groupId: groupFiles.groupId, id: groupFiles.id, filename: groupFiles.filename })
      .from(groupFiles)
      .innerJoin(partGroups, eq(partGroups.id, groupFiles.groupId))
      .where(and(eq(partGroups.robotId, robotId), eq(groupFiles.type, "gcode"))),
  ]);
  const gcodeOf = new Map(gcodes.map(({ groupId, ...f }) => [groupId, f]));
  // `onshapeLayoutUrl`: a batch's Onshape layout assembly (src/lib/fab/onshapeLayout.ts), as a
  // link to open it. Only that string is read: `layout_data` can hold thousands of placements.
  return groups.map((g) => ({ ...g, gcode: gcodeOf.get(g.id) ?? null }));
}

// Group badges on BOM parts.
export async function groupsOfParts(partIds: string[]) {
  if (!partIds.length) return new Map<string, { id: string; name: string; color: string | null }[]>();
  const rows = await db
    .select({ partId: groupMembers.partId, id: partGroups.id, name: partGroups.name, color: partGroups.color })
    .from(groupMembers)
    .innerJoin(partGroups, eq(partGroups.id, groupMembers.groupId))
    .where(inArray(groupMembers.partId, partIds));
  const map = new Map<string, { id: string; name: string; color: string | null }[]>();
  for (const { partId, ...g } of rows) map.set(partId, [...(map.get(partId) ?? []), g]);
  return map;
}
