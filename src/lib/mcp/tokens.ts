import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Personal MCP tokens (plan §6). Only a hash is stored; the token is shown once.
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createMcpToken(memberId: string, label: string | null) {
  const token = `obm_${randomBytes(24).toString("base64url")}`;
  await db.insert(schema.mcpTokens).values({ memberId, tokenHash: hash(token), label });
  return token;
}

// The member a token belongs to, or null. Members who were removed lose their tokens with them.
export async function memberForToken(token: string) {
  if (!/^obm_[\w-]{20,}$/.test(token)) return null;
  const [row] = await db
    .select({ member: schema.members, tokenId: schema.mcpTokens.id })
    .from(schema.mcpTokens)
    .innerJoin(schema.members, eq(schema.members.id, schema.mcpTokens.memberId))
    .where(eq(schema.mcpTokens.tokenHash, hash(token)));
  if (!row) return null;
  await db.update(schema.mcpTokens).set({ lastUsedAt: new Date() }).where(eq(schema.mcpTokens.id, row.tokenId));
  return row.member;
}
