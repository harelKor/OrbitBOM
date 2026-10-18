import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { deleteObject } from "./r2";

const { partFiles, groupFiles, partGroups, parts, systems } = schema;

// The database cascades file rows when a part, system or robot goes; this removes the R2
// objects behind them. Call it before the delete, then run the delete.
export async function fileKeysFor(scope: { partId: string } | { systemId: string } | { robotId: string }) {
  const where =
    "partId" in scope
      ? eq(partFiles.partId, scope.partId)
      : "systemId" in scope
        ? inArray(partFiles.partId, db.select({ id: parts.id }).from(parts).where(eq(parts.systemId, scope.systemId)))
        : inArray(
            partFiles.partId,
            db
              .select({ id: parts.id })
              .from(parts)
              .innerJoin(systems, eq(systems.id, parts.systemId))
              .where(eq(systems.robotId, scope.robotId)),
          );
  const rows = await db.select({ key: partFiles.r2Key }).from(partFiles).where(where);
  const groupRows =
    "robotId" in scope
      ? await db
          .select({ key: groupFiles.r2Key })
          .from(groupFiles)
          .innerJoin(partGroups, eq(partGroups.id, groupFiles.groupId))
          .where(eq(partGroups.robotId, scope.robotId))
      : [];
  return [...rows, ...groupRows].map((r) => r.key);
}

export async function deleteObjects(keys: string[]) {
  await Promise.allSettled(keys.map(deleteObject));
}

export async function fileKeysForGroup(groupId: string) {
  const rows = await db.select({ key: groupFiles.r2Key }).from(groupFiles).where(eq(groupFiles.groupId, groupId));
  return rows.map((r) => r.key);
}
