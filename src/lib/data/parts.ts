import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { computeStatus } from "@/lib/status";
import { imageUrl } from "@/lib/storage/r2";

const { parts, systems, members, partFiles } = schema;

export type PartFileRef = { id: string; type: string; filename: string };

export type BomPart = typeof parts.$inferSelect & {
  status: string;
  systemName: string;
  lastModifiedByName: string | null;
  files: PartFileRef[];
  thumbUrl: string | null;
};

async function load(where: ReturnType<typeof and>): Promise<BomPart[]> {
  const rows = await db
    .select({ part: parts, systemName: systems.name, lastModifiedByName: members.name })
    .from(parts)
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .leftJoin(members, eq(members.id, parts.lastModifiedBy))
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
  return rows.map((r) => ({
    ...r.part,
    thumbUrl: thumbs.get(r.part.id) ?? null,
    status: computeStatus(r.part),
    systemName: r.systemName,
    lastModifiedByName: r.lastModifiedByName,
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

export async function listMemberNames(): Promise<string[]> {
  const rows = await db.select({ name: members.name }).from(members).orderBy(asc(members.name));
  return rows.map((r) => r.name);
}
