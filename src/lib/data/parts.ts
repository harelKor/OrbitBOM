import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { computeStatus } from "@/lib/status";

const { parts, systems, members } = schema;

export type BomPart = typeof parts.$inferSelect & {
  status: string;
  systemName: string;
  lastModifiedByName: string | null;
};

async function load(where: ReturnType<typeof and>): Promise<BomPart[]> {
  const rows = await db
    .select({ part: parts, systemName: systems.name, lastModifiedByName: members.name })
    .from(parts)
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .leftJoin(members, eq(members.id, parts.lastModifiedBy))
    .where(where)
    .orderBy(asc(parts.partNumber), asc(parts.displayName), asc(parts.onshapeName));
  return rows.map((r) => ({
    ...r.part,
    status: computeStatus(r.part),
    systemName: r.systemName,
    lastModifiedByName: r.lastModifiedByName,
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
