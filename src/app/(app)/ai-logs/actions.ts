"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/mode";
import { revertAiBatch } from "@/lib/review/review";
import { isUuid } from "@/lib/uuid";

export type ActionResult = { error?: string; message?: string };

// Revert change on an AI log: everything that run changed goes back to before it.
export async function revertLog(batchId: string): Promise<ActionResult> {
  const member = await requireCapability("manage");
  if (!isUuid(batchId)) return { error: "Unknown change." };
  const { message } = await revertAiBatch(batchId, member.id, "ui");
  revalidatePath("/", "layout");
  return { message };
}
