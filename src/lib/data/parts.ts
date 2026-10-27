import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Shelf, ShelfSuggestion } from "@/components/bom/types";
import { listCategories } from "@/lib/data/categories";
import { groupsOfParts } from "@/lib/data/groups";
import { shelfOfParts } from "@/lib/data/inventory";
import { cotsCategoryOf } from "@/lib/cots";
import { categoryOf, type InvCategory } from "@/lib/inventory/categories";
import { partKey } from "@/lib/model/assembly";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { computeStatus } from "@/lib/status";
import { imageUrl } from "@/lib/storage/r2";

const { parts, systems, robots, members, partFiles, merges, mergeMembers, partDrawings, inventoryItems } = schema;

export type PartFileRef = { id: string; type: string; filename: string };

// Loaded through the part's system, so systemId is always set; only a COTS card added on the COTS
// page has none (systemId "" there).
export type BomPart = Omit<typeof parts.$inferSelect, "systemId"> & {
  systemId: string;
  status: string;
  systemName: string;
  lastModifiedByName: string | null;
  files: PartFileRef[];
  thumbUrl: string | null;
  modelKey: string | null; // the part's key in the robot's 3D model
  groups: { id: string; name: string; color: string | null }[];
  hasDrawing: boolean;
  shelf: Shelf | null;
  shelfSuggestion: ShelfSuggestion | null;
};

async function load(where: ReturnType<typeof and>, { anySystem = false } = {}): Promise<BomPart[]> {
  const base = db.select({ part: parts, systemName: systems.name, lastModifiedByName: members.name, drawingOf: partDrawings.partId }).from(parts);
  const rows = await (anySystem ? base.leftJoin(systems, eq(systems.id, parts.systemId)) : base.innerJoin(systems, eq(systems.id, parts.systemId)))
    .leftJoin(members, eq(members.id, parts.lastModifiedBy))
    .leftJoin(partDrawings, eq(partDrawings.partId, parts.id))
    .where(where)
    .orderBy(asc(parts.partNumber), asc(parts.displayName), asc(parts.onshapeName));
  // Files, thumbnail links, groups and the shelf don't depend on each other: one round trip.
  const ids = rows.map((r) => r.part.id);
  const [files, thumbs, groups, shelf] = await Promise.all([
    ids.length
      ? db
          .select({ id: partFiles.id, partId: partFiles.partId, type: partFiles.type, filename: partFiles.filename })
          .from(partFiles)
          .where(inArray(partFiles.partId, ids))
      : [],
    Promise.all(
      rows
        .filter((r) => r.part.thumbnailRev)
        .map(async (r) => [r.part.id, await imageUrl(thumbKey(r.part.id, r.part.thumbnailRev!))] as const),
    ).then((entries) => new Map(entries)),
    groupsOfParts(ids),
    shelfOfParts(rows.map((r) => r.part)),
  ]);
  const filesOf = new Map<string, PartFileRef[]>();
  for (const { partId, ...f } of files) filesOf.set(partId, [...(filesOf.get(partId) ?? []), f]);
  return rows.map((r) => ({
    ...r.part,
    systemId: r.part.systemId ?? "",
    groups: groups.get(r.part.id) ?? [],
    thumbUrl: thumbs.get(r.part.id) ?? null,
    modelKey:
      r.part.sourceDid && r.part.sourceEid && r.part.onshapePartId ? partKey(r.part.sourceDid, r.part.sourceEid, r.part.onshapePartId) : null,
    status: computeStatus(r.part),
    systemName: r.systemName ?? "",
    lastModifiedByName: r.lastModifiedByName,
    hasDrawing: r.drawingOf !== null,
    files: filesOf.get(r.part.id) ?? [],
    shelf: shelf.shelf.get(r.part.id) ?? null,
    shelfSuggestion: shelf.suggestion.get(r.part.id) ?? null,
  }));
}

export function listSystemParts(systemId: string) {
  return load(and(eq(parts.systemId, systemId), isNull(parts.removedFromCadAt)));
}

export function listRobotParts(robotId: string) {
  return load(and(eq(systems.robotId, robotId), isNull(parts.removedFromCadAt)));
}

// My Parts: live parts on active robots where the member is the designer or a fabricator.
// People are stored by name on the card, as in FRCBOM. The system column shows "Robot › System".
export async function listMyParts(memberName: string) {
  const systemRows = await db
    .select({ id: systems.id, name: systems.name, robotName: robots.name })
    .from(systems)
    .innerJoin(robots, eq(robots.id, systems.robotId))
    .where(eq(robots.archived, false));
  if (!systemRows.length) return [];
  const label = new Map(systemRows.map((s) => [s.id, `${s.robotName} › ${s.name}`]));
  const rows = await load(
    and(
      inArray(
        parts.systemId,
        systemRows.map((s) => s.id),
      ),
      isNull(parts.removedFromCadAt),
      or(
        eq(parts.designerName, memberName),
        sql`exists (select 1 from jsonb_each_text(${parts.fabricators}) f where f.value = ${memberName})`,
      ),
    ),
  );
  return rows.map((p) => ({ ...p, systemName: label.get(p.systemId) ?? p.systemName }));
}

export async function listMemberNames(): Promise<string[]> {
  const rows = await db.select({ name: members.name }).from(members).orderBy(asc(members.name));
  return rows.map((r) => r.name);
}

// A system's merged listings, with their members in a stable order.
export async function listSystemMerges(systemId: string) {
  const rows = await db
    .select({ id: merges.id, name: merges.name, partId: mergeMembers.partId })
    .from(merges)
    .innerJoin(mergeMembers, eq(mergeMembers.mergeId, merges.id))
    .innerJoin(parts, eq(parts.id, mergeMembers.partId))
    .where(eq(merges.systemId, systemId))
    .orderBy(asc(parts.onshapeName), asc(parts.id));
  const out = new Map<string, { id: string; name: string; partIds: string[] }>();
  for (const r of rows) {
    const m = out.get(r.id) ?? { id: r.id, name: r.name, partIds: [] };
    m.partIds.push(r.partId);
    out.set(r.id, m);
  }
  return [...out.values()];
}

export type CotsPart = BomPart & { robotId: string | null; robotName: string | null; category: string };

type CotsNamed = { id: string; displayName: string | null; onshapeName: string | null; material: string | null; cotsCategory: string | null; inventoryItemId: string | null };

// Each COTS part's filter box (an inventory category; a linked item's own category wins), and
// the categories, with their pictures' links.
export async function cotsCategories(list: CotsNamed[]): Promise<{ categories: InvCategory[]; of: Map<string, string> }> {
  const itemIds = [...new Set(list.flatMap((p) => (p.inventoryItemId ? [p.inventoryItemId] : [])))];
  const [categories, items] = await Promise.all([
    listCategories(),
    itemIds.length ? db.select({ id: inventoryItems.id, name: inventoryItems.name, category: inventoryItems.category }).from(inventoryItems).where(inArray(inventoryItems.id, itemIds)) : [],
  ]);
  const ids = categories.map((c) => c.id);
  const itemCat = new Map(items.map((i) => [i.id, categoryOf(i, categories)]));
  await Promise.all(categories.map(async (c) => (c.imageUrl = c.image ? await imageUrl(c.image) : null)));
  return { categories, of: new Map(list.map((p) => [p.id, cotsCategoryOf(p, ids, p.inventoryItemId ? itemCat.get(p.inventoryItemId) : null)])) };
}

// The COTS page: live COTS parts on active robots, each with its robot (null for a card in the
// General section, added on the COTS page for no robot); robots newest first.
export async function listCotsParts(): Promise<{ robots: { id: string; name: string }[]; parts: CotsPart[]; categories: InvCategory[] }> {
  const [robotRows, systemRows] = await Promise.all([
    db.select({ id: robots.id, name: robots.name }).from(robots).where(eq(robots.archived, false)).orderBy(sql`${robots.year} desc`, asc(robots.name)),
    db.select({ id: systems.id, robotId: systems.robotId }).from(systems).innerJoin(robots, eq(robots.id, systems.robotId)).where(eq(robots.archived, false)),
  ]);
  const robotOfSystem = new Map(systemRows.map((s) => [s.id, s.robotId]));
  const nameOf = new Map(robotRows.map((r) => [r.id, r.name]));
  const own = [
    isNull(parts.systemId),
    ...(systemRows.length ? [inArray(parts.systemId, systemRows.map((s) => s.id))] : []),
  ];
  const rows = await load(and(or(...own), isNull(parts.removedFromCadAt), eq(parts.classification, "cots")), { anySystem: true });
  const { categories, of } = await cotsCategories(rows);
  return {
    robots: robotRows,
    categories,
    parts: rows.flatMap((p) => {
      const robotId = p.systemId ? robotOfSystem.get(p.systemId)! : p.robotId;
      // A system-less card of an archived robot stays with that robot.
      if (robotId && !nameOf.has(robotId)) return [];
      return [{ ...p, robotId, robotName: robotId ? nameOf.get(robotId)! : null, category: of.get(p.id)! }];
    }),
  };
}

// How many COTS parts of active robots are in each status, for the COTS home page.
export async function countCotsStatuses(): Promise<Map<string, number>> {
  const rows = await db
    .select({ classification: parts.classification, designState: parts.designState, quantity: parts.quantity, preProcess: parts.preProcess, process1: parts.process1, process2: parts.process2, donePreprocess: parts.donePreprocess, doneProcess1: parts.doneProcess1, doneProcess2: parts.doneProcess2 })
    .from(parts)
    .leftJoin(systems, eq(systems.id, parts.systemId))
    .leftJoin(robots, eq(robots.id, sql`coalesce(${systems.robotId}, ${parts.robotId})`))
    // General cards (no system, no robot) count too.
    .where(and(or(isNull(robots.id), eq(robots.archived, false)), isNull(parts.removedFromCadAt), eq(parts.classification, "cots")));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(computeStatus(r), (counts.get(computeStatus(r)) ?? 0) + 1);
  return counts;
}
