import "server-only";
import { cookies } from "next/headers";
import { can, effectiveMode, MODE_COOKIE, type Capability, type Mode } from "@/components/shell/mode";
import { getMember, requireMember, type Member } from "@/lib/auth";

// The signed-in member's effective mode: an admin's Edit | CAD | Build pick (Edit without one),
// else their team, else "none". Server actions check it too, so a preview is the real thing.
export async function getMode(): Promise<Mode> {
  const member = await getMember();
  if (!member) return "none";
  return effectiveMode(member, (await cookies()).get(MODE_COOKIE)?.value);
}

export async function isEditMode() {
  return (await getMode()) === "edit";
}

export async function hasCapability(cap: Capability) {
  return can(await getMode(), cap);
}

// For server actions: the member, if their mode allows `cap`; otherwise the action fails.
export async function requireCapability(cap: Capability): Promise<Member> {
  const member = await requireMember();
  if (!can(effectiveMode(member, (await cookies()).get(MODE_COOKIE)?.value), cap)) throw new Error(DENIED[cap]);
  return member;
}

export const DENIED: Record<Capability, string> = {
  work: "Pick a team on your profile (Build or CAD) to make changes.",
  draw: "Only the CAD Team can make drawings.",
  review: "Only the CAD Team can review parts.",
  sync: "Only the CAD Team can sync from Onshape.",
  manage: "Only an admin in Edit mode can do this.",
};
