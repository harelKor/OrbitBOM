// Runs against a real Postgres when TEST_DATABASE_URL is set (migrated with npm run db:migrate).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("membership (database)", async () => {
  process.env.DATABASE_URL = url;
  process.env.ADMIN_EMAILS = "boss@team1690.org";
  const { db, schema } = await import("@/db");
  const m = await import("./membership");
  const { eq } = await import("drizzle-orm");

  const user = (email: string) => ({ id: randomUUID(), email, name: email, avatarUrl: null });

  beforeAll(async () => {
    await db.delete(schema.invites);
    await db.delete(schema.joinRequests);
    await db.delete(schema.members);
  });
  afterAll(async () => {
    await db.delete(schema.invites);
    await db.delete(schema.joinRequests);
    await db.delete(schema.members);
  });

  it("makes a listed email an admin on first sign-in", async () => {
    const boss = await m.resolveMembership(user("boss@team1690.org"));
    expect(boss?.isAdmin).toBe(true);
  });

  it("puts an unknown user on the join-request list, then approval makes them a member", async () => {
    const u = user("student@team1690.org");
    expect(await m.resolveMembership(u)).toBeNull();
    expect(await m.resolveMembership(u)).toBeNull(); // signing in again doesn't duplicate
    await m.approveJoinRequest(u.id);
    const member = await m.resolveMembership(u);
    expect(member?.isAdmin).toBe(false);
    const left = await db.select().from(schema.joinRequests).where(eq(schema.joinRequests.userId, u.id));
    expect(left).toHaveLength(0);
  });

  it("redeems an invite once", async () => {
    const [admin] = await db.select().from(schema.members).where(eq(schema.members.isAdmin, true));
    await db.insert(schema.invites).values({
      token: "tok1",
      createdBy: admin.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const a = await m.resolveMembership(user("a@x.org"), "tok1");
    expect(a).not.toBeNull();
    expect(await m.resolveMembership(user("b@x.org"), "tok1")).toBeNull();
  });

  it("ignores an expired invite", async () => {
    const [admin] = await db.select().from(schema.members).where(eq(schema.members.isAdmin, true));
    await db.insert(schema.invites).values({
      token: "old",
      createdBy: admin.id,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await m.resolveMembership(user("c@x.org"), "old")).toBeNull();
  });
});
