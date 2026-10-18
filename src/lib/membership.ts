import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Member, SignedInUser } from "@/lib/auth";

export const INVITE_COOKIE = "orbit_invite";
export const INVITE_TTL_DAYS = 7;

// Emails that become admins on first sign-in (comma-separated ADMIN_EMAILS). This is how the
// first admin gets in; everyone else joins through an invite link or an approved join request.
export function isBootstrapAdmin(email: string, adminEmails = process.env.ADMIN_EMAILS ?? "") {
  return adminEmails
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

async function findMember(userId: string) {
  const [member] = await db
    .select()
    .from(schema.members)
    .where(eq(schema.members.userId, userId))
    .limit(1);
  return member ?? null;
}

async function createMember(user: SignedInUser, isAdmin: boolean): Promise<Member> {
  const [member] = await db
    .insert(schema.members)
    .values({
      userId: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isAdmin,
    })
    .onConflictDoUpdate({ target: schema.members.userId, set: { name: user.name } })
    .returning();
  await db.delete(schema.joinRequests).where(eq(schema.joinRequests.userId, user.id));
  return member;
}

// Uses an invite token if it is valid and unused. Returns the new member, or null.
export async function redeemInvite(user: SignedInUser, token: string): Promise<Member | null> {
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .update(schema.invites)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(schema.invites.token, token),
          isNull(schema.invites.usedAt),
          gt(schema.invites.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!invite) return null;
    const [member] = await tx
      .insert(schema.members)
      .values({ userId: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl })
      .onConflictDoUpdate({ target: schema.members.userId, set: { name: user.name } })
      .returning();
    await tx
      .update(schema.invites)
      .set({ usedBy: member.id })
      .where(eq(schema.invites.token, token));
    await tx.delete(schema.joinRequests).where(eq(schema.joinRequests.userId, user.id));
    return member;
  });
}

// Called after every Google sign-in. Returns the member, or null when the user now waits on a
// join request.
export async function resolveMembership(
  user: SignedInUser,
  inviteToken?: string,
): Promise<Member | null> {
  const existing = await findMember(user.id);
  if (existing) return existing;

  if (isBootstrapAdmin(user.email)) return createMember(user, true);

  if (inviteToken) {
    const member = await redeemInvite(user, inviteToken);
    if (member) return member;
  }

  await db
    .insert(schema.joinRequests)
    .values({ userId: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl })
    .onConflictDoNothing();
  return null;
}

export async function approveJoinRequest(userId: string): Promise<void> {
  const [request] = await db
    .select()
    .from(schema.joinRequests)
    .where(eq(schema.joinRequests.userId, userId))
    .limit(1);
  if (!request) return;
  await createMember(
    { id: request.userId, email: request.email, name: request.name, avatarUrl: request.avatarUrl },
    false,
  );
}
