import "server-only";
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { imageUrl } from "@/lib/storage/r2";

const { parts, partHistory, systems, members } = schema;

export type RecentAction = {
  visitId: string;
  page: string;
  pageName: string;
  memberName: string | null;
  at: Date; // the visit's last change
  fields: string[];
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
const fieldName = (f: string) => FIELD_NAMES[f] ?? f.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

const THUMBS = 6;

// The robot's recent actions: each page visit in which someone changed its parts, newest first.
export async function listRecentActions(robotId: string, limit = 9): Promise<RecentAction[]> {
  const at = sql<Date>`max(${partHistory.at})`.mapWith((v: string | Date) => new Date(v));
  const visits = await db
    .select({
      visitId: sql<string>`${partHistory.visitId}`,
      page: sql<string>`max(${partHistory.page})`,
      memberId: sql<string | null>`(array_agg(${partHistory.memberId} order by ${partHistory.at} desc))[1]`,
      at,
      fields: sql<string[]>`array_agg(distinct ${partHistory.field})`,
      partIds: sql<string[]>`array_agg(${partHistory.partId} order by ${partHistory.at} desc)`,
    })
    .from(partHistory)
    .innerJoin(parts, eq(parts.id, partHistory.partId))
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .where(
      and(
        eq(systems.robotId, robotId),
        isNotNull(partHistory.visitId),
        ne(partHistory.field, "overriddenFields"),
      ),
    )
    .groupBy(partHistory.visitId)
    .orderBy(desc(at))
    .limit(limit);
  if (!visits.length) return [];

  const partIdsOf = (v: (typeof visits)[number]) => [...new Set(v.partIds)];
  const shownIds = [...new Set(visits.flatMap((v) => partIdsOf(v).slice(0, THUMBS)))];
  const memberIds = [...new Set(visits.flatMap((v) => (v.memberId ? [v.memberId] : [])))];
  const [shown, names, systemNames] = await Promise.all([
    db
      .select({ id: parts.id, displayName: parts.displayName, onshapeName: parts.onshapeName, thumbnailRev: parts.thumbnailRev })
      .from(parts)
      .where(inArray(parts.id, shownIds)),
    memberIds.length ? db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, memberIds)) : [],
    db.select({ id: systems.id, name: systems.name }).from(systems).where(eq(systems.robotId, robotId)),
  ]);
  const thumbUrls = new Map(
    await Promise.all(shown.map(async (p) => [p.id, p.thumbnailRev ? await imageUrl(thumbKey(p.id, p.thumbnailRev)) : null] as const)),
  );
  const partById = new Map(shown.map((p) => [p.id, p]));
  const memberName = new Map(names.map((m) => [m.id, m.name]));
  const systemName = new Map(systemNames.map((s) => [s.id, s.name]));

  return visits.map((v) => {
    const ids = partIdsOf(v);
    return {
      visitId: v.visitId,
      page: v.page,
      pageName: pageName(v.page, systemName),
      memberName: v.memberId ? (memberName.get(v.memberId) ?? null) : null,
      at: v.at,
      fields: [...new Set(v.fields.map(fieldName))],
      partCount: ids.length,
      firstPartId: ids[0],
      thumbs: ids.slice(0, THUMBS).map((id) => {
        const p = partById.get(id);
        return { id, name: p?.displayName ?? p?.onshapeName ?? "Part", url: thumbUrls.get(id) ?? null };
      }),
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
