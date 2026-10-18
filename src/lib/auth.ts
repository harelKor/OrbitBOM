import "server-only";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { createClient } from "@/lib/supabase/server";

export type SignedInUser = { id: string; email: string; name: string; avatarUrl: string | null };
export type Member = typeof schema.members.$inferSelect;

// The signed-in Google user, or null. Cached per request.
// getClaims verifies the session JWT locally against the project's cached signing keys, so a
// page doesn't wait on a round trip to Supabase Auth (getUser makes one on every call).
export const getUser = cache(async (): Promise<SignedInUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.email) return null;
  const meta = claims.user_metadata ?? {};
  return {
    id: claims.sub,
    email: claims.email.toLowerCase(),
    name: meta.full_name ?? meta.name ?? claims.email,
    avatarUrl: meta.avatar_url ?? meta.picture ?? null,
  };
});

export const getMember = cache(async (): Promise<Member | null> => {
  const user = await getUser();
  if (!user) return null;
  const [member] = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.userId, user.id))
    .limit(1);
  return member ?? null;
});

// For pages and actions that need a team member. Signed-out users go to /login, signed-in
// users who are not members yet go to /pending.
export async function requireMember(): Promise<Member> {
  const user = await getUser();
  if (!user) redirect("/login");
  const member = await getMember();
  if (!member) redirect("/pending");
  return member;
}

export async function requireAdmin(): Promise<Member> {
  const member = await requireMember();
  if (!member.isAdmin) redirect("/");
  return member;
}
