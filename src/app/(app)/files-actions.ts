"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { PART_FILE_TYPES, type PartFileType } from "@/config/fileTypes";
import { db, schema } from "@/db";
import { requireAdmin, requireMember } from "@/lib/auth";
import { StorageNotConfiguredError, deleteObject, fileKey, objectExists, presignUpload } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";

const { partFiles, groupFiles, parts, partGroups } = schema;
const MAX_BYTES = 200 * 1024 * 1024;

// Files hang off a part or a part group, one file per type each, as in FRCBOM.
export type FileOwner = { kind: "part" | "group"; id: string };

const isType = (t: string): t is PartFileType => PART_FILE_TYPES.some((f) => f.id === t);
const prefix = (owner: FileOwner, type: string) => `${owner.kind}s/${owner.id}/${type}`;
const validOwner = (o: FileOwner) => (o.kind === "part" || o.kind === "group") && isUuid(o.id);

function refresh() {
  revalidatePath("/robots", "layout");
  revalidatePath("/groups");
}

export type UploadStart = { error: string } | { url: string; key: string };

// Step 1 of an upload: a presigned PUT the browser sends the file to.
export async function startUpload(owner: FileOwner, type: string, filename: string, size: number): Promise<UploadStart> {
  await requireMember();
  if (!validOwner(owner) || !isType(type)) return { error: "Unknown file type." };
  if (!filename.trim()) return { error: "The file has no name." };
  if (size > MAX_BYTES) return { error: "Files can be at most 200 MB." };
  const table = owner.kind === "part" ? parts : partGroups;
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, owner.id));
  if (!row) return { error: `Unknown ${owner.kind}.` };
  try {
    const key = fileKey(prefix(owner, type), filename);
    return { url: await presignUpload(key), key };
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return { error: err.message };
    throw err;
  }
}

// Step 2: record the uploaded file, replacing the owner's previous file of that type.
export async function finishUpload(
  owner: FileOwner,
  type: string,
  key: string,
  filename: string,
  contentType: string,
): Promise<{ error?: string }> {
  const member = await requireMember();
  if (!validOwner(owner) || !isType(type) || !key.startsWith(`${prefix(owner, type)}/`)) {
    return { error: "Unknown upload." };
  }
  if (!(await objectExists(key))) return { error: "The upload didn't reach file storage. Try again." };
  const name = filename.slice(0, 255);
  const old = await db.transaction(async (tx) => {
    if (owner.kind === "part") {
      const previous = await tx
        .delete(partFiles)
        .where(and(eq(partFiles.partId, owner.id), eq(partFiles.type, type)))
        .returning({ r2Key: partFiles.r2Key });
      await tx.insert(partFiles).values({
        partId: owner.id,
        type,
        r2Key: key,
        filename: name,
        contentType: contentType || null,
        uploadedBy: member.id,
      });
      return previous;
    }
    const previous = await tx
      .delete(groupFiles)
      .where(and(eq(groupFiles.groupId, owner.id), eq(groupFiles.type, type)))
      .returning({ r2Key: groupFiles.r2Key });
    await tx.insert(groupFiles).values({ groupId: owner.id, type, r2Key: key, filename: name });
    return previous;
  });
  await Promise.all(old.map((f) => deleteObject(f.r2Key)));
  refresh();
  return {};
}

// Deleting files is an admin action (plan, Roles).
export async function deleteFile(kind: FileOwner["kind"], fileId: string): Promise<{ error?: string }> {
  await requireAdmin();
  if (!isUuid(fileId)) return { error: "Unknown file." };
  const table = kind === "part" ? partFiles : groupFiles;
  const [file] = await db.delete(table).where(eq(table.id, fileId)).returning({ r2Key: table.r2Key });
  if (file) await deleteObject(file.r2Key);
  refresh();
  return {};
}
