"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { approveReviews, rejectReviews, suggestRobotSetups } from "@/lib/review/review";
import { isUuid } from "@/lib/uuid";

export type ActionResult = { error?: string; message?: string };

function refresh() {
  revalidatePath("/robots", "layout");
}

export async function approveParts(partIds: string[]): Promise<ActionResult> {
  await requireMember();
  if (partIds.some((id) => !isUuid(id))) return { error: "Unknown part." };
  await approveReviews(partIds);
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
