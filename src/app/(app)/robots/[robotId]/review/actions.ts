"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/mode";
import { approveInventoryReviews, dismissInventoryReviews, rejectInventoryReviews } from "@/lib/review/inventory";
import { approveReviews, dismissReviews, partReview, rejectReviews, suggestOnePart, suggestRobotSetups } from "@/lib/review/review";
import { isUuid } from "@/lib/uuid";

export type ActionResult = { error?: string; message?: string };

// Approve and Reject revalidate before they return, so the page's next props already leave the
// decided parts out (the page hides them the moment they're clicked).
function refresh() {
  revalidatePath("/robots", "layout");
}

export async function approveParts(partIds: string[]): Promise<ActionResult> {
  const member = await requireCapability("review");
  if (partIds.some((id) => !isUuid(id))) return { error: "Unknown part." };
  await approveReviews(partIds, member.id);
  refresh();
  return {};
}

export async function rejectParts(partIds: string[]): Promise<ActionResult> {
  const member = await requireCapability("review");
  if (partIds.some((id) => !isUuid(id))) return { error: "Unknown part." };
  const { keptEdits } = await rejectReviews(partIds, member.id);
  refresh();
  return keptEdits ? { message: `Put back the suggestion. ${keptEdits} field${keptEdits === 1 ? " was" : "s were"} edited since and kept as edited.` } : {};
}

// The card's X: the part leaves To Review as it is now. A link waiting for Approve isn't made,
// and isn't remembered as rejected either.
export async function dismissParts(partIds: string[]): Promise<ActionResult> {
  await requireCapability("review");
  if (partIds.some((id) => !isUuid(id))) return { error: "Unknown part." };
  await dismissReviews(partIds);
  refresh();
  return {};
}

export async function dismissInventory(ids: string[]): Promise<ActionResult> {
  await requireCapability("review");
  if (ids.some((id) => !isUuid(id))) return { error: "Unknown change." };
  await dismissInventoryReviews(ids);
  refresh();
  return {};
}

// To Review's Inventory section: a Claude's edits to items and new categories.
export async function approveInventory(ids: string[]): Promise<ActionResult> {
  await requireCapability("review");
  if (ids.some((id) => !isUuid(id))) return { error: "Unknown change." };
  await approveInventoryReviews(ids);
  refresh();
  return {};
}

export async function rejectInventory(ids: string[]): Promise<ActionResult> {
  const member = await requireCapability("review");
  if (ids.some((id) => !isUuid(id))) return { error: "Unknown change." };
  const { keptEdits } = await rejectInventoryReviews(ids, member.id);
  refresh();
  revalidatePath("/inventory", "layout");
  return keptEdits ? { message: `Put back the old values. ${keptEdits} field${keptEdits === 1 ? " was" : "s were"} edited since and kept as edited.` } : {};
}

// Runs the site's rules over the robot's parts that have no material or processes. Reads the
// 3D model's files for part sizes; never calls Onshape. With a systemId, only that subsystem's parts.
export async function suggestSetup(robotId: string, systemId?: string): Promise<ActionResult> {
  const member = await requireCapability("review");
  if (!isUuid(robotId) || (systemId && !isUuid(systemId))) return { error: "Unknown robot." };
  const { checked, suggested, linked } = await suggestRobotSetups(robotId, member.id, systemId);
  refresh();
  if (!checked) return { message: `Every part${systemId ? " in this subsystem" : ""} already has a material and processes.` };
  const left = checked - suggested;
  return {
    message:
      `Set up ${suggested} of ${checked} parts that needed it.` +
      (linked ? ` Suggested ${linked} inventory ${linked === 1 ? "link" : "links"}.` : "") +
      (left ? ` ${left} need a person or Claude: ask it to "set up the parts of this robot that have no material".` : ""),
  };
}

// ---------- one part, from its window ----------

export type PartReviewState = Awaited<ReturnType<typeof partReview>>;

export async function partReviewState(partId: string): Promise<PartReviewState> {
  await requireCapability("work");
  if (!isUuid(partId)) return null;
  return partReview(partId);
}

// The part window's Suggest: setup rules plus auto-link on that one part, into To Review.
export async function suggestPart(partId: string): Promise<ActionResult> {
  const member = await requireCapability("review");
  if (!isUuid(partId)) return { error: "Unknown part." };
  const r = await suggestOnePart(partId, member.id);
  if (!r) return { error: "Unknown part." };
  refresh();
  if (!r.setUp && !r.linked) return { message: "Nothing to change: the part's material and processes are already what Suggest would pick, and no inventory item clearly matches it." };
  return {};
}
