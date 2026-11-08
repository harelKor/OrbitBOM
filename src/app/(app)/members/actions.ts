"use server";

import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import type { Team } from "@/config/teams";
import { requireAdmin } from "@/lib/auth";
import { approveJoinRequest, INVITE_TTL_DAYS } from "@/lib/membership";
import { saveTeam } from "@/lib/teams";
import { isUuid } from "@/lib/uuid";

export async function createInvite() {
  const admin = await requireAdmin();
  await db.insert(schema.invites).values({
    token: randomBytes(18).toString("base64url"),
    createdBy: admin.id,
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
  });
  revalidatePath("/members");
}

export async function revokeInvite(token: string) {
  await requireAdmin();
  await db
    .delete(schema.invites)
    .where(and(eq(schema.invites.token, token), isNull(schema.invites.usedAt)));
  revalidatePath("/members");
}

export async function approveRequest(userId: string) {
  await requireAdmin();
  await approveJoinRequest(userId);
  revalidatePath("/members");
}

export async function denyRequest(userId: string) {
  await requireAdmin();
  await db
    .update(schema.joinRequests)
    .set({ status: "denied" })
    .where(eq(schema.joinRequests.userId, userId));
  revalidatePath("/members");
}

export async function setAdmin(memberId: string, isAdmin: boolean) {
  const admin = await requireAdmin();
  if (memberId === admin.id && !isAdmin) throw new Error("You can't remove your own admin flag.");
  await db.update(schema.members).set({ isAdmin }).where(eq(schema.members.id, memberId));
  revalidatePath("/members");
}

// Mentors approve or reject ticked-off CAD Review comments (Harel, 2026-11-08).
export async function setMentor(memberId: string, isMentor: boolean) {
  await requireAdmin();
  await db.update(schema.members).set({ isMentor }).where(eq(schema.members.id, memberId));
  revalidatePath("/members");
}

export async function removeMember(memberId: string) {
  const admin = await requireAdmin();
  if (memberId === admin.id) throw new Error("You can't remove yourself.");
  await db.delete(schema.members).where(eq(schema.members.id, memberId));
  revalidatePath("/members");
}

export async function setMemberTeam(memberId: string, team: Team | null, systemId: string | null) {
  await requireAdmin();
  if (!isUuid(memberId)) return;
  await saveTeam(memberId, team, systemId);
  revalidatePath("/members");
}
