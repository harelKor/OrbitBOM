"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { approveInventoryReviews, dismissInventoryReviews, rejectInventoryReviews } from "@/lib/review/inventory";
import { approveReviews, dismissReviews, rejectReviews, suggestRobotSetups } from "@/lib/review/review";
import { isUuid } from "@/lib/uuid";

export type ActionResult = { error?: string; message?: string };

// Approve and Reject revalidate before they return, so the page's next props already leave the
// decided parts out (the page hides them the moment they're clicked).
function refresh() {
  revalidatePath("/robots", "layout");
}

export async function approveParts(partIds: string[]): Promise<ActionResult> {
  const member = await requireMember();
  if (partIds.some((id) => !isUuid(id))) return { error: "Unknown part." };
  await approveReviews(partIds, member.id);
  refresh();
  return {};
}

export async function rejectParts(partIds: string[]): Promise<ActionResult> {
  const member = await requireMember();
  if (partIds.some((id) => !isUuid(id))) return { error: "Unknown part." };
  const { keptEdits } = await rejectReviews(partIds, member.id);
  refresh();
  return keptEdits ? { message: `Put back the suggestion. ${keptEdits} field${keptEdits === 1 ? " was" : "s were"} edited since and kept as edited.` } : {};
}

// The card's X: the part leaves To Review as it is now. A link waiting for Approve isn't made,
// and isn't remembered as rejected either.
export async function dismissParts(partIds: string[]): Promise<ActionResult> {
  await requireMember();
  if (partIds.some((id) => !isUuid(id))) return { error: "Unknown part." };
  await dismissReviews(partIds);
  refresh();
  return {};
}

export async function dismissInventory(ids: string[]): Promise<ActionResult> {
  await requireMember();
  if (ids.some((id) => !isUuid(id))) return { error: "Unknown change." };
  await dismissInventoryReviews(ids);
  refresh();
  return {};
}

// To Review's Inventory section: a Claude's edits to items and new categories.
export async function approveInventory(ids: string[]): Promise<ActionResult> {
  await requireMember();
  if (ids.some((id) => !isUuid(id))) return { error: "Unknown change." };
  await approveInventoryReviews(ids);
  refresh();
  return {};
}

export async function rejectInventory(ids: string[]): Promise<ActionResult> {
  const member = await requireMember();
  if (ids.some((id) => !isUuid(id))) return { error: "Unknown change." };
  const { keptEdits } = await rejectInventoryReviews(ids, member.id);
  refresh();
  revalidatePath("/inventory", "layout");
  return keptEdits ? { message: `Put back the old values. ${keptEdits} field${keptEdits === 1 ? " was" : "s were"} edited since and kept as edited.` } : {};
}

// Runs the site's rules over the robot's parts that have no material or processes. Reads the
// 3D model's files for part sizes; never calls Onshape.
export async function suggestSetup(robotId: string): Promise<ActionResult> {
  const member = await requireMember();
  if (!isUuid(robotId)) return { error: "Unknown robot." };
  const { checked, suggested } = await suggestRobotSetups(robotId, member.id);
  refresh();
  if (!checked) return { message: "Every part already has a material and processes." };
  const left = checked - suggested;
  return {
    message:
      `Set up ${suggested} of ${checked} parts that needed it.` +
      (left ? ` ${left} need a person or Claude: ask it to "set up the parts of this robot that have no material".` : ""),
  };
}
