"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { requireCapability } from "@/lib/mode";
import { backupUrl, latestBackupUrl, saveNightlyBackup } from "@/lib/storage/backup";
import { RESTORE_SCOPES, restoreBackup, type RestoreScope } from "@/lib/storage/restore";
import { cleanUpStorage, deleteVersionPreviews, recountStorage, storageUsage, type StorageUsage } from "@/lib/storage/usage";
import { restoreFromTrash } from "@/lib/trash";
import { isUuid } from "@/lib/uuid";

// The storage window's contents (database only).
export async function loadStorage(): Promise<StorageUsage> {
  await requireMember();
  return storageUsage();
}

const mb = (n: number) => `${(n / 1024 ** 2).toFixed(1)} MB`;

// Delete a version's 3D previews (the version and its Revert stay).
export async function deletePreviews(versionId: string): Promise<{ message?: string; error?: string }> {
  await requireCapability("manage");
  if (!isUuid(versionId)) return { error: "Unknown version." };
  const r = await deleteVersionPreviews(versionId);
  revalidatePath("/robots", "layout");
  return { message: `Freed ${mb(r.freed)} (${r.files} ${r.files === 1 ? "preview" : "previews"}).` };
}

// Recount the bucket now and free unused files (what the nightly run does).
export async function recountAndClean(): Promise<{ message?: string; error?: string }> {
  await requireCapability("manage");
  const count = await recountStorage();
  const clean = await cleanUpStorage();
  revalidatePath("/robots", "layout");
  return { message: `Counted ${count.files} files.${clean.files ? ` Cleaned up ${mb(clean.freed)}.` : ""}` };
}

// The storage window's Backups row: a short-lived link to the newest backup file.
export async function downloadLatestBackup(): Promise<{ url?: string; error?: string }> {
  await requireMember();
  const url = await latestBackupUrl().catch(() => null);
  return url ? { url } : { error: "No backup yet. The first one is saved tonight." };
}

// "Back up now": what the nightly run saves, today's file replaced.
export async function backUpNow(): Promise<{ message?: string; error?: string }> {
  await requireCapability("manage");
  const r = await saveNightlyBackup().catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
  if ("error" in r) return { error: r.error };
  if ("skipped" in r) return { error: `Not saved: ${r.skipped}.` };
  return { message: `Backed up ${r.rows} rows (${mb(r.bytes)}).` };
}

// Settings → Backups: a short-lived link to one backup file.
export async function downloadBackup(key: string): Promise<{ url?: string; error?: string }> {
  await requireMember();
  const url = await backupUrl(key).catch(() => null);
  return url ? { url } : { error: "That backup is gone." };
}

// Settings → Backups → Restore (admins): the chosen parts of the app go back to the backup. A
// copy of how things are now is saved first, so the restore can be undone the same way.
export async function restoreFromBackup(key: string, scopes: string[], removeAdded = false): Promise<{ message?: string; error?: string }> {
  const member = await requireCapability("manage");
  if (!member.isAdmin) return { error: "Only admins can restore a backup." };
  const chosen = scopes.filter((s): s is RestoreScope => s in RESTORE_SCOPES);
  try {
    const r = await restoreBackup(key, chosen, { removeAdded });
    const restored = r.tables.reduce((n, t) => n + t.restored, 0);
    const removed = r.tables.reduce((n, t) => n + t.removed, 0);
    revalidatePath("/", "layout");
    return {
      message: `Restored ${chosen.map((s) => RESTORE_SCOPES[s].label).join(" and ")}: ${restored} rows back${removed ? `, ${removed} added since removed` : ""}. To undo, restore ${r.safetyCopy?.replace("backups/", "")}.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Settings → Recently deleted (admins): brings back a deleted robot, system, part or item with
// everything that went with it (lib/trash.ts).
export async function restoreDeleted(id: string): Promise<{ message?: string; error?: string }> {
  const member = await requireMember();
  if (!member.isAdmin) return { error: "Only admins can bring back what was deleted." };
  if (!isUuid(id)) return { error: "Unknown entry." };
  try {
    const r = await restoreFromTrash(id);
    revalidatePath("/", "layout");
    return { message: `Brought back ${r.label} (${r.restored} ${r.restored === 1 ? "row" : "rows"}).` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
