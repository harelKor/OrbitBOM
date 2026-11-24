// Runs against a real Postgres when TEST_DATABASE_URL is set. Onshape is replaced by a fake fetch.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

const DID = "1123456789abcdef01234567";
const WID = "99abcdef0123456789abcdef";
const EID = "aedcba9876543210fedcba98";

if (!url) describe.skip("background refresh (database): set TEST_DATABASE_URL", () => {});
else
  describe("background refresh (database)", async () => {
    process.env.DATABASE_URL = url;
    process.env.ONSHAPE_TOKEN_KEY = randomBytes(32).toString("base64");
    const { db, schema } = await import("@/db");
    const { and, eq } = await import("drizzle-orm");
    const { encrypt } = await import("@/lib/crypto");
    const { updateBomFromOnshape } = await import("./updateBom");
    const { refreshSystem, refreshDueSystems } = await import("./refresh");

    const headers = [
      { id: "n", name: "Name" },
      { id: "q", name: "Quantity" },
    ];
    let names = ["Plate"];
    let microversion = "mv1";
    const calls: string[] = [];
    // Accounts whose token Onshape refuses (403) while the test runs.
    const refused = new Set<string>();
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
      if (refused.has(auth.replace("Bearer ", ""))) return new Response("{}", { status: 403 });
      calls.push(input);
      const body = input.includes("currentmicroversion")
        ? { microversion }
        : input.includes("/parts/d/")
          ? []
          : {
            headers,
            rows: names.map((n, i) => ({
              itemSource: { documentId: DID, elementId: "studio", partId: `P${i}`, wvmType: "w", wvmId: WID },
              headerIdToValue: { n, q: 1 },
            })),
          };
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const userId = randomUUID();
    const [member] = await db
      .insert(schema.members)
      .values({ userId, email: `${userId}@t.org`, name: "Refresh Tester", onshapeConnected: true })
      .returning();
    await db.insert(schema.onshapeTokens).values({
      memberId: member.id,
      accessTokenEnc: encrypt("access"),
      refreshTokenEnc: encrypt("refresh"),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const [robot] = await db.insert(schema.robots).values({ name: "Refresh bot", year: 2027 }).returning();
    const [system] = await db
      .insert(schema.systems)
      .values({
        robotId: robot.id,
        name: "Intake",
        assemblyUrl: `https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}`,
      })
      .returning();
    const getSystem = async () => (await db.select().from(schema.systems).where(eq(schema.systems.id, system.id)))[0];
    const later = Date.now() + 50_000;

    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("leaves systems nobody has synced by hand", async () => {
      const results = await refreshDueSystems(later);
      expect(results.find((r) => r.systemId === system.id)).toBeUndefined();
    });

    it("makes the member who updates the system the refresh account", async () => {
      await updateBomFromOnshape(system.id, member.id);
      const s = await getSystem();
      expect(s.refreshMemberId).toBe(member.id);
      expect(s.lastCheckedAt).not.toBeNull();
    });

    it("checks a due system once and skips it until the interval passes", async () => {
      await db.update(schema.systems).set({ lastCheckedAt: null }).where(eq(schema.systems.id, system.id));
      calls.length = 0;
      const first = await refreshSystem(system.id, member.id, later, 10);
      expect(first).toMatchObject({ changed: false, calls: 1 });
      expect(calls).toHaveLength(1);
      expect(await refreshSystem(system.id, member.id, later, 10)).toBeNull();
      expect(calls).toHaveLength(1);
    });

    it("keeps what changed in the system's draft, not in the BOM", async () => {
      await db
        .update(schema.systems)
        .set({ lastCheckedAt: new Date(Date.now() - 3600_000) })
        .where(eq(schema.systems.id, system.id));
      microversion = "mv2";
      names = ["Plate", "Spacer"];
      const results = await refreshDueSystems(later);
      expect(results.find((r) => r.systemId === system.id)).toMatchObject({ changed: true });
      const parts = await db.select().from(schema.parts).where(eq(schema.parts.systemId, system.id));
      expect(parts.map((p) => p.onshapeName)).toEqual(["Plate"]);
      const [draft] = await db.select().from(schema.systemVersions).where(and(eq(schema.systemVersions.systemId, system.id), eq(schema.systemVersions.state, "draft")));
      expect(draft.changes.map((c) => [c.change, c.name])).toEqual([["added", "Spacer"]]);
    });

    it("never borrows another member's account when the refresh account is out of calls", async () => {
      const { DAILY_CALL_BUDGET } = await import("@/lib/onshape/client");
      const backupUser = randomUUID();
      const [backup] = await db
        .insert(schema.members)
        .values({ userId: backupUser, email: `${backupUser}@t.org`, name: "Backup Tester", onshapeConnected: true })
        .returning();
      await db.insert(schema.onshapeTokens).values({
        memberId: backup.id,
        accessTokenEnc: encrypt("backup-access"),
        refreshTokenEnc: encrypt("backup-refresh"),
        expiresAt: new Date(Date.now() + 3600_000),
      });
      try {
        const today = new Date().toISOString().slice(0, 10);
        await db.update(schema.onshapeTokens).set({ callsToday: DAILY_CALL_BUDGET, callsDay: today }).where(eq(schema.onshapeTokens.memberId, member.id));
        await db.update(schema.systems).set({ lastCheckedAt: null, refreshMemberId: member.id }).where(eq(schema.systems.id, system.id));
        const spent = await refreshSystem(system.id, member.id, later, 10);
        expect(spent?.error).toMatch(/budget/);
        expect((await getSystem()).refreshMemberId).toBe(member.id);
        const [b] = await db.select().from(schema.onshapeTokens).where(eq(schema.onshapeTokens.memberId, backup.id));
        expect(b.callsToday).toBe(0);
      } finally {
        await db.update(schema.onshapeTokens).set({ callsToday: 0 }).where(eq(schema.onshapeTokens.memberId, member.id));
        await db.update(schema.systems).set({ refreshMemberId: member.id }).where(eq(schema.systems.id, system.id));
        await db.delete(schema.members).where(eq(schema.members.id, backup.id));
      }
    });

    it("skips robots in the Old folder", async () => {
      await db.update(schema.robots).set({ folder: "old" }).where(eq(schema.robots.id, robot.id));
      await db.update(schema.systems).set({ lastCheckedAt: null }).where(eq(schema.systems.id, system.id));
      const results = await refreshDueSystems(later);
      expect(results.find((r) => r.systemId === system.id)).toBeUndefined();
    });
  });
