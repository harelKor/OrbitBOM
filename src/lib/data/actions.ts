import "server-only";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  like,
  ne,
  notExists,
  sql,
} from "drizzle-orm";
import { db, schema } from "@/db";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { imageUrl } from "@/lib/storage/r2";
import { versionLabel } from "@/lib/versions/label";

const {
  parts,
  partHistory,
  systems,
  members,
  dismissedActions,
  systemVersions,
} = schema;

export type RecentAction = {
  kind?: "edit" | "system"; // a page visit's part edits, or a System Update (a committed version)
  visitId: string; // the visit, or for a System Update its version
  label?: string; // a System Update's version, "V70"
  page: string;
  pageName: string;
  memberName: string | null;
  at: Date; // the visit's last change
  fields: string[];
  statusTo: string | null; // the last status set by hand in the visit
  partCount: number;
  firstPartId: string;
  thumbs: { id: string; name: string; url: string | null }[];
};

// What each changed field is called on an action box. Status is stored as the fields it sets.
const FIELD_NAMES: Record<string, string> = {
  designState: "Status",
  donePreprocess: "Status",
  doneProcess1: "Status",
  doneProcess2: "Status",
  material: "Material",
  preProcess: "Processes",
  process1: "Processes",
  process2: "Processes",
  extraProcesses: "Processes",
  classification: "Type",
  displayName: "Name",
  partNumber: "Part number",
  quantity: "Quantity",
  note: "Note",
  fabricators: "Fabricators",
  drawingUrl: "Drawing",
  inventoryItemId: "Inventory",
  priority: "Priority",
  deadline: "Deadline",
  designerName: "Designer",
  description: "Description",
  estMinutes: "Time",
  actualMinutes: "Time",
};
export const fieldName = (f: string) =>
  FIELD_NAMES[f] ??
  f.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

const THUMBS = 6;

// Status is stored as these fields (see applyStatus and applyCounters).
const STATUS_FIELDS = [
  "designState",
  "donePreprocess",
  "doneProcess1",
  "doneProcess2",
];

// An action drops off a week after it happened, or when the member closes it.
const KEEP_DAYS = 7;

export type ActionScope = {
  robotId: string;
  memberId: string; // whose dismissed actions to leave out
  systemId?: string; // only this system's parts
  fabOnly?: boolean; // only status changes made on To Fab
};

// Recent actions: each page visit in which someone changed the scope's parts, and each System
// Update (plan/system-versioning.md §8), newest first.
export async function listRecentActions(
  scope: ActionScope,
  limit = 9,
): Promise<RecentAction[]> {
  const [edits, updates] = await Promise.all([
    editActions(scope, limit),
    scope.fabOnly ? [] : systemUpdates(scope, limit),
  ]);
  return [...edits, ...updates]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}

async function editActions(
  scope: ActionScope,
  limit: number,
): Promise<RecentAction[]> {
  const { robotId } = scope;
  const since = new Date(Date.now() - KEEP_DAYS * 86_400_000);
  const at = sql<Date>`max(${partHistory.at})`.mapWith(
    (v: string | Date) => new Date(v),
  );
  const visits = await db
    .select({
      visitId: sql<string>`${partHistory.visitId}`,
      page: sql<string>`max(${partHistory.page})`,
      memberId: sql<
        string | null
      >`(array_agg(${partHistory.memberId} order by ${partHistory.at} desc))[1]`,
      at,
      fields: sql<string[]>`array_agg(distinct ${partHistory.field})`,
      statusTo: sql<
        string | null
      >`(array_remove(array_agg(case when ${partHistory.field} = 'designState' then ${partHistory.newValue} #>> '{}' end order by ${partHistory.at} desc), null))[1]`,
      partIds: sql<
        string[]
      >`array_agg(${partHistory.partId} order by ${partHistory.at} desc)`,
    })
    .from(partHistory)
    .innerJoin(parts, eq(parts.id, partHistory.partId))
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .where(
      and(
        eq(systems.robotId, robotId),
        scope.systemId ? eq(parts.systemId, scope.systemId) : undefined,
        isNotNull(partHistory.visitId),
        gte(partHistory.at, since),
        scope.fabOnly
          ? and(
              like(partHistory.page, "/robots/%/fab%"),
              inArray(partHistory.field, STATUS_FIELDS),
            )
          : ne(partHistory.field, "overriddenFields"),
        notExists(
          db
            .select({ one: sql`1` })
            .from(dismissedActions)
            .where(
              and(
                eq(dismissedActions.memberId, scope.memberId),
                eq(dismissedActions.visitId, partHistory.visitId),
              ),
            ),
        ),
      ),
    )
    .groupBy(partHistory.visitId)
    .orderBy(desc(at))
    .limit(limit);
  if (!visits.length) return [];

  const partIdsOf = (v: (typeof visits)[number]) => [...new Set(v.partIds)];
  const shownIds = [
    ...new Set(visits.flatMap((v) => partIdsOf(v).slice(0, THUMBS))),
  ];
  const memberIds = [
    ...new Set(visits.flatMap((v) => (v.memberId ? [v.memberId] : []))),
  ];
  const [shown, names, systemNames] = await Promise.all([
    db
      .select({
        id: parts.id,
        displayName: parts.displayName,
        onshapeName: parts.onshapeName,
        thumbnailRev: parts.thumbnailRev,
      })
      .from(parts)
      .where(inArray(parts.id, shownIds)),
    memberIds.length
      ? db
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(inArray(members.id, memberIds))
      : [],
    db
      .select({ id: systems.id, name: systems.name })
      .from(systems)
      .where(eq(systems.robotId, robotId)),
  ]);
  const thumbUrls = new Map(
    await Promise.all(
      shown.map(
        async (p) =>
          [
            p.id,
            p.thumbnailRev
              ? await imageUrl(thumbKey(p.id, p.thumbnailRev))
              : null,
          ] as const,
      ),
    ),
  );
  const partById = new Map(shown.map((p) => [p.id, p]));
  const memberName = new Map(names.map((m) => [m.id, m.name]));
  const systemName = new Map(systemNames.map((s) => [s.id, s.name]));

  return visits.map((v) => {
    const ids = partIdsOf(v);
    return {
      kind: "edit" as const,
      visitId: v.visitId,
      page: v.page,
      pageName: pageName(v.page, systemName),
      memberName: v.memberId ? (memberName.get(v.memberId) ?? null) : null,
      at: v.at,
      fields: [...new Set(v.fields.map(fieldName))],
      statusTo: v.statusTo,
      partCount: ids.length,
      firstPartId: ids[0],
      thumbs: ids.slice(0, THUMBS).map((id) => {
        const p = partById.get(id);
        return {
          id,
          name: p?.displayName ?? p?.onshapeName ?? "Part",
          url: thumbUrls.get(id) ?? null,
        };
      }),
    };
  });
}

// The week's committed versions, as System Update actions (light blue boxes).
async function systemUpdates(
  scope: ActionScope,
  limit: number,
): Promise<RecentAction[]> {
  const since = new Date(Date.now() - KEEP_DAYS * 86_400_000);
  const rows = await db
    .select({
      v: systemVersions,
      systemName: systems.name,
      memberName: members.name,
    })
    .from(systemVersions)
    .innerJoin(systems, eq(systems.id, systemVersions.systemId))
    .leftJoin(members, eq(members.id, systemVersions.committedBy))
    .where(
      and(
        eq(systems.robotId, scope.robotId),
        scope.systemId
          ? eq(systemVersions.systemId, scope.systemId)
          : undefined,
        eq(systemVersions.state, "committed"),
        gte(systemVersions.committedAt, since),
        sql`${systemVersions.seq} > 0`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(dismissedActions)
            .where(
              and(
                eq(dismissedActions.memberId, scope.memberId),
                eq(dismissedActions.visitId, systemVersions.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(systemVersions.committedAt))
    .limit(limit);
  if (!rows.length) return [];
  const ids = [
    ...new Set(
      rows.flatMap(({ v }) =>
        v.changes.flatMap((c) => (c.partId ? [c.partId] : [])).slice(0, THUMBS),
      ),
    ),
  ];
  const shown = ids.length
    ? await db
        .select({
          id: parts.id,
          displayName: parts.displayName,
          onshapeName: parts.onshapeName,
          thumbnailRev: parts.thumbnailRev,
        })
        .from(parts)
        .where(inArray(parts.id, ids))
    : [];
  const byId = new Map(
    await Promise.all(
      shown.map(
        async (p) =>
          [
            p.id,
            {
              name: p.displayName ?? p.onshapeName ?? "Part",
              url: p.thumbnailRev
                ? await imageUrl(thumbKey(p.id, p.thumbnailRev))
                : null,
            },
          ] as const,
      ),
    ),
  );
  return rows.map(({ v, systemName, memberName }) => {
    const partIds = [
      ...new Set(v.changes.flatMap((c) => (c.partId ? [c.partId] : []))),
    ];
    const count = (k: string) => v.changes.filter((c) => c.change === k).length;
    const fields = [
      count("modified") && `${count("modified")} changed`,
      count("added") && `${count("added")} added`,
      count("removed") && `${count("removed")} removed`,
    ].filter(Boolean) as string[];
    return {
      kind: "system" as const,
      visitId: v.id,
      label: versionLabel(v),
      page: `/robots/${scope.robotId}/systems/${v.systemId}?versions=1`,
      pageName: systemName,
      memberName,
      at: v.committedAt!,
      fields,
      statusTo: null,
      partCount: partIds.length,
      firstPartId: partIds[0] ?? "",
      thumbs: partIds
        .slice(0, THUMBS)
        .map((id) => ({
          id,
          name: byId.get(id)?.name ?? "Part",
          url: byId.get(id)?.url ?? null,
        })),
    };
  });
}

// "Shooter", "To Fab", "Dashboard"... from the visit's path.
export function pageName(page: string, systemName: Map<string, string>) {
  const path = page.split(/[?#]/)[0];
  const system = /^\/robots\/[^/]+\/systems\/([^/]+)/.exec(path);
  if (system) return systemName.get(system[1]) ?? "A system";
  if (/^\/robots\/[^/]+\/fab/.test(path)) return "To Fab";
  if (/^\/robots\/[^/]+\/review/.test(path)) return "To Review";
  if (/^\/robots\/[^/]+\/main/.test(path)) return "Main assembly";
  if (/^\/robots\/[^/]+\/?$/.test(path)) return "Dashboard";
  if (path.startsWith("/my-parts")) return "My parts";
  if (path.startsWith("/groups")) return "Groups";
  if (path.startsWith("/inventory")) return "Inventory";
  return "Another page";
}
