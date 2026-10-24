// Runs against a real Postgres when TEST_DATABASE_URL is set. Onshape is replaced by a fake fetch.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

const DID = "0123456789abcdef01234567";
const WID = "89abcdef0123456789abcdef";
const EID = "fedcba9876543210fedcba98";

if (!url) describe.skip("updateBomFromOnshape (database): set TEST_DATABASE_URL", () => {});
else
  describe("updateBomFromOnshape (database)", async () => {
    process.env.DATABASE_URL = url;
    process.env.ONSHAPE_TOKEN_KEY = randomBytes(32).toString("base64");
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { encrypt } = await import("@/lib/crypto");
    const { applyPartChanges } = await import("@/lib/parts/apply");
    const { updateBomFromOnshape } = await import("./updateBom");

    const headers = [
      { id: "n", name: "Name" },
      { id: "q", name: "Quantity" },
      { id: "m", name: "Material" },
      { id: "p1", name: "Process 1" },
    ];
    const row = (partId: string, name: string, qty: number, p1: string | null = "CNC") => ({
      itemSource: { documentId: DID, elementId: "studio", partId, wvmType: "w", wvmId: WID },
      headerIdToValue: { n: name, q: qty, m: { displayName: "Aluminum - 6061" }, p1 },
    });

    let bomRows: unknown[] = [];
    let microversion = "mv1";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      calls.push(input);
      const body = input.includes("currentmicroversion") ? { microversion } : input.includes("/parts/d/") ? [] : { headers, rows: bomRows };
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const userId = randomUUID();
    const [member] = await db
      .insert(schema.members)
      .values({ userId, email: `${userId}@t.org`, name: "Sync Tester", onshapeConnected: true })
      .returning();
    await db.insert(schema.onshapeTokens).values({
      memberId: member.id,
      accessTokenEnc: encrypt("access"),
      refreshTokenEnc: encrypt("refresh"),
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const [robot] = await db.insert(schema.robots).values({ name: "Sync bot", year: 2027 }).returning();
    const [system] = await db
      .insert(schema.systems)
      .values({
        robotId: robot.id,
        name: "Drive",
        assemblyUrl: `https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}`,
      })
      .returning();

    const live = async () =>
      (await db.select().from(schema.parts).where(eq(schema.parts.systemId, system.id))).sort((a, b) =>
        (a.onshapeName ?? "").localeCompare(b.onshapeName ?? ""),
      );

    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("pulls a new system's BOM", async () => {
      bomRows = [row("A", "Plate", 2), row("B", "Bolt", 8, null), row("C", "Tube", 1)];
      const s = await updateBomFromOnshape(system.id, member.id);
      expect(s.added.sort()).toEqual(["Bolt", "Plate", "Tube"]);
      expect(s.calls).toBe(3); // change check, BOM, the Part Studio's parts list
      expect(s.version).toBe(1);
      const ps = await live();
      expect(ps.map((p) => [p.onshapeName, p.quantity, p.process1, p.classification])).toEqual([
        ["Bolt", 8, null, "undefined"],
        ["Plate", 2, "cnc", "inhouse"],
        ["Tube", 1, "cnc", "inhouse"],
      ]);
    });

    it("keeps team edits and handles removed and re-keyed parts", async () => {
      const [, plate, tube] = await live();
      await applyPartChanges([plate.id], { status: "Gcoded", material: "3mm 6061-T6", note: "x" }, { memberId: member.id, via: "ui" });
      await applyPartChanges([tube.id], { status: "Ordered" }, { memberId: member.id, via: "ui" });

      microversion = "mv2";
      // Plate qty changes; Bolt leaves CAD; Tube gets a new partId (re-keyed).
      bomRows = [row("A", "Plate", 3), row("Z", "Tube", 1)];
      const s = await updateBomFromOnshape(system.id, member.id, { force: false });
      expect(s.removed).toEqual(["Bolt"]);
      expect(s.added).toEqual([]);

      const [bolt, plate2, tube2] = await live();
      expect(bolt.removedFromCadAt).not.toBeNull();
      expect(plate2).toMatchObject({ quantity: 3, material: "3mm 6061-T6", designState: "Gcoded", note: "x" });
      expect(tube2).toMatchObject({ id: tube.id, onshapePartId: "Z", designState: "Ordered" });
    });

    it("stops after the change check when nothing changed", async () => {
      calls.length = 0;
      const s = await updateBomFromOnshape(system.id, member.id, { force: false });
      expect(s.skipped).toBe("unchanged");
      expect(calls).toHaveLength(1);
    });

    it("brings back a part that returns to CAD", async () => {
      microversion = "mv3";
      bomRows = [row("A", "Plate", 3), row("Z", "Tube", 1), row("B", "Bolt", 8, null)];
      const s = await updateBomFromOnshape(system.id, member.id);
      expect(s.version).toBe(3);
      expect((await live()).every((p) => p.removedFromCadAt === null)).toBe(true);
    });
  });
