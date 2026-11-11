import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Shelf, ShelfSuggestion } from "@/components/bom/types";
import { categoryImageUrl, listCategories } from "@/lib/data/categories";
import { groupsOfParts } from "@/lib/data/groups";
import { shelfOfParts } from "@/lib/data/inventory";
import { cotsCategoryOf } from "@/lib/cots";
import { categoryOf, type InvCategory } from "@/lib/inventory/categories";
import { partKey } from "@/lib/model/assembly";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { onshapeUrl, parseOnshapeUrl, type WVM } from "@/lib/onshape/url";
import { isOnshapeDrawingKey } from "@/lib/parts/files";
import { computeStatus } from "@/lib/status";
import { versionLabel } from "@/lib/versions/label";
import { fabChanged } from "@/lib/versions/release";
import { imageUrl } from "@/lib/storage/r2";

const { parts, partVersions, systems, systemVersions, robots, members, partFiles, merges, mergeMembers, partDrawings, inventoryItems, partReviews } = schema;

// `onshape`: a drawing pulled from an Onshape drawing tab (Sync Onshape drawings).
export type PartFileRef = { id: string; type: string; filename: string; onshape?: boolean };

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
  review: boolean; // a suggestion waits in To Review: the card shows ✓ / ✕
  // The state the part was released to fab at (plan/fab-version-lock.md); To Fab shows it.
  fabLock: FabLock | null;
};

export type FabLock = {
  label: string | null; // "V70"
  name: string | null; // the version's name
  partName: string | null;
  quantity: number;
  material: string | null;
  thumbUrl: string | null;
  studio: string | null;
  bomLabel: string | null; // the BOM's version when it moved past the locked one: "Fab: V4 (BOM: V5)"
  changed: boolean; // the BOM's latest state differs in shape or quantity: To Fab's red Changed tag
  at: string;
};

async function load(where: ReturnType<typeof and>, { anySystem = false } = {}): Promise<BomPart[]> {
  const base = db.select({ part: parts, systemName: systems.name, lastModifiedByName: members.name, drawingOf: partDrawings.partId, reviewOf: partReviews.partId }).from(parts);
  const rows = await (anySystem ? base.leftJoin(systems, eq(systems.id, parts.systemId)) : base.innerJoin(systems, eq(systems.id, parts.systemId)))
    .leftJoin(members, eq(members.id, parts.lastModifiedBy))
    .leftJoin(partDrawings, eq(partDrawings.partId, parts.id))
    .leftJoin(partReviews, eq(partReviews.partId, parts.id))
    .where(where)
    .orderBy(asc(parts.partNumber), asc(parts.displayName), asc(parts.onshapeName));
  // Files, thumbnail links, groups and the shelf don't depend on each other: one round trip.
  const ids = rows.map((r) => r.part.id);
  const [files, thumbs, lockedThumbs, labels, groups, shelf] = await Promise.all([
    ids.length
      ? db
          .select({ id: partFiles.id, partId: partFiles.partId, type: partFiles.type, filename: partFiles.filename, r2Key: partFiles.r2Key })
          .from(partFiles)
          .where(inArray(partFiles.partId, ids))
      : [],
    Promise.all(
      rows
        .filter((r) => r.part.thumbnailRev)
        .map(async (r) => [r.part.id, await imageUrl(thumbKey(r.part.id, r.part.thumbnailRev!))] as const),
    ).then((entries) => new Map(entries)),
    // Pictures kept for a released state that the BOM has moved past.
    Promise.all(
      rows
        .filter((r) => r.part.releasedSnapshot?.thumbnailRev && r.part.releasedSnapshot.thumbnailRev !== r.part.thumbnailRev)
        .map(async (r) => [r.part.id, await imageUrl(thumbKey(r.part.id, r.part.releasedSnapshot!.thumbnailRev!))] as const),
    ).then((entries) => new Map(entries)),
    bomLabels(rows.map((r) => r.part).filter((p) => p.releasedSnapshot && p.versionRowId && p.versionRowId !== p.releasedRowId).map((p) => p.versionRowId!)),
    groupsOfParts(ids),
    shelfOfParts(rows.map((r) => r.part)),
  ]);
  const filesOf = new Map<string, PartFileRef[]>();
  for (const { partId, r2Key, ...f } of files) {
    filesOf.set(partId, [...(filesOf.get(partId) ?? []), isOnshapeDrawingKey(r2Key) ? { ...f, onshape: true } : f]);
  }
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
    review: r.reviewOf !== null,
    files: filesOf.get(r.part.id) ?? [],
    shelf: shelf.shelf.get(r.part.id) ?? null,
    shelfSuggestion: shelf.suggestion.get(r.part.id) ?? null,
    fabLock: fabLockOf(r.part, lockedThumbs.get(r.part.id) ?? thumbs.get(r.part.id) ?? null, labels.get(r.part.versionRowId ?? "") ?? null),
  }));
}

function fabLockOf(p: typeof parts.$inferSelect, thumbUrl: string | null, bomLabel: string | null): FabLock | null {
  const s = p.releasedSnapshot;
  if (!s) return null;
  return { label: s.versionLabel, name: s.versionName, partName: s.name, quantity: s.quantity, material: s.material, thumbUrl, studio: s.studio, bomLabel: bomLabel !== s.versionLabel ? bomLabel : null, changed: fabChanged(p), at: s.at };
}

// The version labels ("V70") of these part version rows.
async function bomLabels(rowIds: string[]): Promise<Map<string, string>> {
  if (!rowIds.length) return new Map();
  const rows = await db
    .select({ id: partVersions.id, seq: systemVersions.seq, onshapeRef: systemVersions.onshapeRef })
    .from(partVersions)
    .innerJoin(systemVersions, eq(systemVersions.id, partVersions.versionId))
    .where(inArray(partVersions.id, rowIds));
  return new Map(rows.map((r) => [r.id, versionLabel(r)]));
}

export function listSystemParts(systemId: string) {
  return load(and(eq(parts.systemId, systemId), isNull(parts.removedFromCadAt)));
}

// One part, for its details window opened away from its BOM page (an inventory item's Used in),
// with the robot it's on (for Locate). Null when it was deleted.
export async function getPart(partId: string): Promise<{ part: BomPart; robotId: string | null } | null> {
  const [part] = await load(eq(parts.id, partId), { anySystem: true });
  if (!part) return null;
  const [sys] = part.systemId ? await db.select({ robotId: systems.robotId }).from(systems).where(eq(systems.id, part.systemId)) : [];
  return { part, robotId: sys?.robotId ?? null };
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
  await Promise.all(categories.map(async (c) => (c.imageUrl = await categoryImageUrl(c.image))));
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

// The robot's BOM parts by their key in its 3D model, for a 3D view that has no cards to read
// them from (a part window's Locate in robot): a click there names the part and opens it.
// `onshape`: the part's Part Studio in Onshape, a plain link for the 3D menu's "Open in Onshape"
// (no API call), on the host of its system's assembly.
export type ModelPart = { key: string; id: string; systemId: string; name: string; onshape?: string };
export async function modelPartsOfRobot(robotId: string): Promise<ModelPart[]> {
  const rows = await db
    .select({
      id: parts.id,
      systemId: parts.systemId,
      did: parts.sourceDid,
      eid: parts.sourceEid,
      pid: parts.onshapePartId,
      wvm: parts.sourceWvm,
      wid: parts.sourceWid,
      assemblyUrl: systems.assemblyUrl,
      displayName: parts.displayName,
      onshapeName: parts.onshapeName,
    })
    .from(parts)
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .where(eq(systems.robotId, robotId));
  return rows.flatMap((r) => {
    if (!r.did || !r.eid || !r.pid || !r.systemId) return [];
    // Onshape's BOM gives "w" / "v" / "m"; the long names are taken too, to be safe.
    const t = r.wvm?.toLowerCase()[0];
    const wvm = t === "w" || t === "v" || t === "m" ? (t as WVM) : null;
    const baseUrl = (r.assemblyUrl && parseOnshapeUrl(r.assemblyUrl)?.baseUrl) || "https://cad.onshape.com";
    return [
      {
        key: partKey(r.did, r.eid, r.pid),
        id: r.id,
        systemId: r.systemId,
        name: r.displayName ?? r.onshapeName ?? "Unnamed part",
        ...(wvm && r.wid && { onshape: onshapeUrl({ baseUrl, did: r.did, wvm, wvmid: r.wid, eid: r.eid }) }),
      },
    ];
  });
}
