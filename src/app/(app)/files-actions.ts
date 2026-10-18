"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { PART_FILE_TYPES, type PartFileType } from "@/config/fileTypes";
import { db, schema } from "@/db";
import { requireAdmin, requireMember } from "@/lib/auth";
import { StorageNotConfiguredError, deleteObject, fileKey, objectExists, presignUpload } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";

const { partFiles, parts } = schema;
const MAX_BYTES = 200 * 1024 * 1024;

const isType = (t: string): t is PartFileType => PART_FILE_TYPES.some((f) => f.id === t);
const prefix = (partId: string, type: string) => `parts/${partId}/${type}`;

export type UploadStart = { error: string } | { url: string; key: string };

// Step 1 of an upload: a presigned PUT the browser sends the file to.
export async function startPartUpload(
  partId: string,
  type: string,
  filename: string,
  size: number,
): Promise<UploadStart> {
  await requireMember();
  if (!isUuid(partId) || !isType(type)) return { error: "Unknown part or file type." };
  if (!filename.trim()) return { error: "The file has no name." };
  if (size > MAX_BYTES) return { error: "Files can be at most 200 MB." };
  const [part] = await db.select({ id: parts.id }).from(parts).where(eq(parts.id, partId));
  if (!part) return { error: "Unknown part." };
  try {
    const key = fileKey(prefix(partId, type), filename);
    return { url: await presignUpload(key), key };
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return { error: err.message };
    throw err;
  }
}

// Step 2: record the uploaded file. One file per type per part, as in FRCBOM; a new upload
// replaces the old one.
export async function finishPartUpload(
  partId: string,
  type: string,
  key: string,
  filename: string,
  contentType: string,
): Promise<{ error?: string }> {
  const member = await requireMember();
  if (!isUuid(partId) || !isType(type) || !key.startsWith(`${prefix(partId, type)}/`)) {
    return { error: "Unknown upload." };
  }
  if (!(await objectExists(key))) return { error: "The upload didn't reach file storage. Try again." };
  const old = await db.transaction(async (tx) => {
    const previous = await tx
      .delete(partFiles)
      .where(and(eq(partFiles.partId, partId), eq(partFiles.type, type)))
      .returning({ r2Key: partFiles.r2Key });
    await tx.insert(partFiles).values({
      partId,
      type,
      r2Key: key,
      filename: filename.slice(0, 255),
      contentType: contentType || null,
      uploadedBy: member.id,
    });
    return previous;
  });
  await Promise.all(old.map((f) => deleteObject(f.r2Key)));
  revalidatePath("/robots", "layout");
  return {};
}

// Deleting files is an admin action (plan, Roles).
export async function deletePartFile(fileId: string): Promise<{ error?: string }> {
  await requireAdmin();
  if (!isUuid(fileId)) return { error: "Unknown file." };
  const [file] = await db.delete(partFiles).where(eq(partFiles.id, fileId)).returning();
  if (file) await deleteObject(file.r2Key);
  revalidatePath("/robots", "layout");
  return {};
}
