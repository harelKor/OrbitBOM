import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

const { storedFiles } = schema;

export type StoredKind = "studio" | "part" | "preview" | "thumb" | "file" | "image" | "backup" | "other";

// What a key holds, from its prefix.
export function kindOf(key: string): StoredKind {
  if (key.startsWith("models/studios/")) return "studio";
  if (key.startsWith("models/parts/")) return "part";
  if (key.startsWith("models/previews/")) return "preview";
  if (key.startsWith("thumbs/")) return "thumb";
  if (key.startsWith("parts/") || key.startsWith("groups/")) return "file";
  if (key.startsWith("inventory/")) return "image";
  if (key.startsWith("backups/")) return "backup";
  return "other";
}

// The byte ledger is bookkeeping: a failed write never fails the upload, and the nightly
// recount corrects it.
export async function recordStored(key: string, bytes: number, versionId?: string | null) {
  const values = { key, bytes, kind: kindOf(key), ...(versionId ? { versionId } : {}) };
  await db
    .insert(storedFiles)
    .values(values)
    .onConflictDoUpdate({ target: storedFiles.key, set: { bytes, ...(versionId ? { versionId } : {}) } })
    .catch((err) => console.warn("Storage ledger write skipped", err instanceof Error ? err.message : err));
}

export async function recordDeleted(key: string) {
  await db
    .delete(storedFiles)
    .where(eq(storedFiles.key, key))
    .catch((err) => console.warn("Storage ledger delete skipped", err instanceof Error ? err.message : err));
}
