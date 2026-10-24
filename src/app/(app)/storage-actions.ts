"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { cleanUpStorage, deleteVersionPreviews, recountStorage, storageUsage, type StorageUsage } from "@/lib/storage/usage";
import { isUuid } from "@/lib/uuid";

// The storage window's contents (database only).
export async function loadStorage(): Promise<StorageUsage> {
  await requireMember();
  return storageUsage();
}

const mb = (n: number) => `${(n / 1024 ** 2).toFixed(1)} MB`;

// Delete a version's 3D previews (the version and its Revert stay).
export async function deletePreviews(versionId: string): Promise<{ message?: string; error?: string }> {
  await requireMember();
  if (!isUuid(versionId)) return { error: "Unknown version." };
  const r = await deleteVersionPreviews(versionId);
  revalidatePath("/robots", "layout");
  return { message: `Freed ${mb(r.freed)} (${r.files} ${r.files === 1 ? "preview" : "previews"}).` };
}

// Recount the bucket now and free unused files (what the nightly run does).
export async function recountAndClean(): Promise<{ message?: string; error?: string }> {
  await requireMember();
  const count = await recountStorage();
  const clean = await cleanUpStorage();
  revalidatePath("/robots", "layout");
  return { message: `Counted ${count.files} files.${clean.files ? ` Cleaned up ${mb(clean.freed)}.` : ""}` };
}
