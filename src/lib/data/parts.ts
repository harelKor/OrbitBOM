import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { groupsOfParts } from "@/lib/data/groups";
import { partKey } from "@/lib/model/assembly";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { computeStatus } from "@/lib/status";
import { imageUrl } from "@/lib/storage/r2";

const { parts, systems, robots, members, partFiles, merges, mergeMembers, partDrawings } = schema;

export type PartFileRef = { id: string; type: string; filename: string };

export type BomPart = typeof parts.$inferSelect & {
  status: string;
  systemName: string;
  lastModifiedByName: string | null;
  files: PartFileRef[];
  thumbUrl: string | null;
  modelKey: string | null; // the part's key in the robot's 3D model
  groups: { id: string; name: string; color: string | null }[];
  hasDrawing: boolean;
};

async function load(where: ReturnType<typeof and>): Promise<BomPart[]> {
  const rows = await db
    .select({ part: parts, systemName: systems.name, lastModifiedByName: members.name, drawingOf: partDrawings.partId })
    .from(parts)
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .leftJoin(members, eq(members.id, parts.lastModifiedBy))
    .leftJoin(partDrawings, eq(partDrawings.partId, parts.id))
    .where(where)
    .orderBy(asc(parts.partNumber), asc(parts.displayName), asc(parts.onshapeName));
  const files = rows.length
    ? await db
        .select({ id: partFiles.id, partId: partFiles.partId, type: partFiles.type, filename: partFiles.filename })
        .from(partFiles)
        .where(
          inArray(
            partFiles.partId,
            rows.map((r) => r.part.id),
          ),
        )
    : [];
  const thumbs = new Map(
    await Promise.all(
      rows
        .filter((r) => r.part.thumbnailRev)
        .map(async (r) => [r.part.id, await imageUrl(thumbKey(r.part.id, r.part.thumbnailRev!))] as const),
    ),
  );
  const groups = await groupsOfParts(rows.map((r) => r.part.id));
  return rows.map((r) => ({
    ...r.part,
    groups: groups.get(r.part.id) ?? [],
    thumbUrl: thumbs.get(r.part.id) ?? null,
    modelKey:
      r.part.sourceDid && r.part.sourceEid && r.part.onshapePartId ? partKey(r.part.sourceDid, r.part.sourceEid, r.part.onshapePartId) : null,
    status: computeStatus(r.part),
    systemName: r.systemName,
    lastModifiedByName: r.lastModifiedByName,
    hasDrawing: r.drawingOf !== null,
    files: files.filter((f) => f.partId === r.part.id).map(({ id, type, filename }) => ({ id, type, filename })),
  }));
}

export function listSystemParts(systemId: string) {
  return load(and(eq(parts.systemId, systemId), isNull(parts.removedFromCadAt)));
}

export async function listRobotParts(robotId: string) {
  const ids = await db.select({ id: systems.id }).from(systems).where(eq(systems.robotId, robotId));
  if (!ids.length) return [];
  return load(
    and(
      inArray(
        parts.systemId,
        ids.map((s) => s.id),
      ),
      isNull(parts.removedFromCadAt),
    ),
  );
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
