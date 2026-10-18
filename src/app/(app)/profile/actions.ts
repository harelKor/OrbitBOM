"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { createMcpToken } from "@/lib/mcp/tokens";
import { disconnect } from "@/lib/onshape/client";
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
