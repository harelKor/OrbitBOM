"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import type { Team } from "@/config/teams";
import { requireMember } from "@/lib/auth";
import { createMcpToken } from "@/lib/mcp/tokens";
import { disconnect } from "@/lib/onshape/client";
import { saveTeam } from "@/lib/teams";
import { isUuid } from "@/lib/uuid";

export async function disconnectOnshape() {
  const member = await requireMember();
  await disconnect(member.id);
  revalidatePath("/profile");
}

export async function createMcpTokenAction(label: string): Promise<{ token: string }> {
  const member = await requireMember();
  const token = await createMcpToken(member.id, label.trim().slice(0, 60) || null);
  revalidatePath("/profile");
  return { token };
}

export async function revokeMcpToken(tokenId: string) {
  const member = await requireMember();
  if (!isUuid(tokenId)) return;
  await db
    .delete(schema.mcpTokens)
    .where(and(eq(schema.mcpTokens.id, tokenId), eq(schema.mcpTokens.memberId, member.id)));
  revalidatePath("/profile");
}

// The member's own display name, shown across the app (Google's name until they change it).
export async function renameSelf(name: string): Promise<{ error?: string }> {
  const member = await requireMember();
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!clean) return { error: "Enter a name." };
  await db.update(schema.members).set({ name: clean }).where(eq(schema.members.id, member.id));
  revalidatePath("/", "layout");
  return {};
}

// The member's own team and, for CAD Team, their subsystem.
export async function setOwnTeam(team: Team | null, systemId: string | null) {
  const member = await requireMember();
  await saveTeam(member.id, team, systemId);
  revalidatePath("/profile");
  revalidatePath("/members");
}
