import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { deleteObject } from "@/lib/storage/r2";

const { partFiles, parts } = schema;

// A drawing pulled from an Onshape drawing tab is stored under this key, so the next sync can tell
// the tab hasn't changed (same element and microversion) and skip exporting it again.
export const onshapeDrawingKey = (partId: string, eid: string, microversion: string) =>
  `parts/${partId}/drawing/onshape-${eid}-${microversion.replace(/\W/g, "").slice(0, 24) || "0"}.pdf`;
export const isOnshapeDrawingKey = (key: string) => /\/drawing\/onshape-/.test(key);

// Record a file already in R2 as the part's file of that type, replacing (and deleting) the old one.
export async function replacePartFile(
  partId: string,
  type: (typeof schema.partFileType.enumValues)[number],
  file: { key: string; filename: string; contentType: string | null; memberId: string },
) {
  const old = await db.transaction(async (tx) => {
    // Locks the part, so two uploads of the same file at once replace each other in turn.
    await tx.select({ id: parts.id }).from(parts).where(eq(parts.id, partId)).for("update");
    const previous = await tx
      .delete(partFiles)
      .where(and(eq(partFiles.partId, partId), eq(partFiles.type, type)))
      .returning({ r2Key: partFiles.r2Key });
    await tx.insert(partFiles).values({
      partId,
      type,
      r2Key: file.key,
      filename: file.filename.slice(0, 255),
      contentType: file.contentType || null,
      uploadedBy: file.memberId,
    });
    return previous;
  });
  await Promise.all(old.filter((f) => f.r2Key !== file.key).map((f) => deleteObject(f.r2Key)));
}
