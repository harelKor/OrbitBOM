// Runs against a real Postgres when TEST_DATABASE_URL is set. Onshape and R2 are a fake fetch.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

const DID = "4123456789abcdef01234567";
const WID = "b9abcdef0123456789abcdef";
const EID = "cedcba9876543210fedcba98";
const S1 = "d1dcba9876543210fedcba98";
const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

if (!url) describe.skip("Update CAD (database): set TEST_DATABASE_URL", () => {});
else
  describe("Update CAD (database)", async () => {
    process.env.DATABASE_URL = url;
    process.env.ONSHAPE_TOKEN_KEY = randomBytes(32).toString("base64");
    Object.assign(process.env, { R2_ENDPOINT: "https://r2.test", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" });
    const { db, schema } = await import("@/db");
    const { eq, sql } = await import("drizzle-orm");
    const { encrypt } = await import("@/lib/crypto");
    const { checkModelUpdate, commitModelUpdate, listCadUpdates } = await import("./cad");
    const { loadSystemReview } = await import("@/lib/data/cadReview");

    // The workspace: its microversion, the Part Studio's revision at each, and its parts.
    let mv = "mv1";
    const revOf: Record<string, string> = { mv1: "r1" };
    let parts: Record<string, string[]> = { mv1: ["A"] };
    // Shapes by Part Studio revision: part → volume.
    const shapes: Record<string, Record<string, number>> = { r1: { A: 1 }, r2: { A: 1, B: 2 } };
    let versions = [{ id: "v12", name: "V12", createdAt: "2026-11-01T00:00:00Z" }];
    const bucket = new Map<string, string>();
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      const u = new URL(req.url);
      if (u.host === "r2.test") {
        const key = decodeURIComponent(u.pathname.replace(/^\/b\//, ""));
        if (req.method === "PUT") bucket.set(key, "file");
        return new Response(bucket.get(key) ?? null, { status: req.method === "HEAD" && !bucket.has(key) ? 404 : 200 });
      }
      const path = u.pathname.replace(/^\/api\/v\d+\//, "");
      calls.push(`${req.method} ${path}`);
      const json = (b: unknown) => new Response(JSON.stringify(b));
      const at = path.match(/\/m\/(\w+)\//)?.[1] ?? mv;
      if (path.endsWith("/currentmicroversion")) return json({ microversion: mv });
      if (path.startsWith("assemblies/")) {
        const list = parts[at] ?? [];
        return json({
          rootAssembly: {
            instances: list.map((p) => ({ id: `i${p}`, type: "Part", documentId: DID, elementId: S1, partId: p, name: `${p === "A" ? "Plate" : "Spacer"} <1>` })),
            occurrences: list.map((p) => ({ path: [`i${p}`], transform: I4 })),
          },
        });
      }
      if (path.endsWith("/elements")) return json([{ id: S1, microversionId: revOf[at] }]);
      if (path.includes("/massproperties")) {
        const wanted = [...u.searchParams.getAll("partId")];
        const s = shapes[revOf[at]];
        return json({ bodies: Object.fromEntries(wanted.map((id) => [id, { volume: [s[id]], periphery: [6], principalInertia: [1, 2, 3], hasMass: true }])) });
      }
      if (path.includes("/tessellatedfaces")) return json([]);
      if (path === `documents/d/${DID}/versions` && req.method === "POST") {
        const sent = (await req.json()) as { name: string; microversionId: string };
        const made = { id: "v13", name: sent.name, createdAt: "2026-11-13T00:00:00Z" };
        versions = [...versions, made];
        return json(made);
      }
      if (path === `documents/d/${DID}/versions`) return json(versions);
      return new Response("not found", { status: 404 });
    });

    await db.delete(schema.onshapeCache).where(sql`key like ${`%${DID}%`}`);
    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "CAD Tester", onshapeConnected: true }).returning();
    await db.insert(schema.onshapeTokens).values({ memberId: member.id, accessTokenEnc: encrypt("access"), refreshTokenEnc: encrypt("refresh"), expiresAt: new Date(Date.now() + 3600_000) });
    const [robot] = await db.insert(schema.robots).values({ name: "CAD bot", year: 2027 }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Arm", assemblyUrl: `https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}` }).returning();
    const owner = { systemId: system.id };
    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
    });

    it("lists the parts, then commits a sub-version pinned to the microversion", async () => {
      const d = await checkModelUpdate("final", owner, member.id);
      // Nothing built yet: every part is new.
      expect(d.changes.map((c) => [c.name, c.change])).toEqual([["Plate", "added"]]);
      // The new Part Studio file was exported for the preview.
      expect([...bucket.keys()].some((k) => k.startsWith(`models/studios/${DID}/${S1}/`))).toBe(true);
      const r = await commitModelUpdate("final", owner, d.id, member.id, { makeVersion: false });
      expect(r.label).toBe("V12 v1");
      const [s] = await db.select().from(schema.systems).where(eq(schema.systems.id, system.id));
      expect(s.modelRef).toEqual({ wvm: "m", wvmid: "mv1" });
      // The check can't be committed twice.
      await expect(commitModelUpdate("final", owner, d.id, member.id, { makeVersion: false })).rejects.toThrow(/newer one/);
    });

    it("leaves out a part of the same shape whose Part Studio changed, and makes a version", async () => {
      mv = "mv2";
      revOf.mv2 = "r2";
      parts = { ...parts, mv2: ["A", "B"] };
      const d = await checkModelUpdate("final", owner, member.id);
      expect(d.changes.map((c) => [c.name, c.change])).toEqual([["Spacer", "added"]]);
      calls.length = 0;
      const r = await commitModelUpdate("final", owner, d.id, member.id, { makeVersion: true });
      expect(r.label).toBe("V13");
      expect(calls).toEqual([`GET documents/d/${DID}/versions`, `POST documents/d/${DID}/versions`]);
      const [s] = await db.select().from(schema.systems).where(eq(schema.systems.id, system.id));
      expect(s.modelRef).toEqual({ wvm: "v", wvmid: "v13" });
    });

    it("puts the sub-version on its version in the Final's tree, and none in the Basepart's", async () => {
      const updates = await listCadUpdates(owner, "final");
      expect(updates.subs.map((u) => [u.label, u.parentVid])).toEqual([["V12 v1", "v12"]]);
      expect((await listCadUpdates(owner, "basepart")).subs).toEqual([]);
      const review = await loadSystemReview(system.id);
      const v12 = review!.tree.find((n) => n.key === "v12");
      expect(v12?.subs.map((x) => x.label)).toEqual(["V12 v1"]);
      expect(review!.tree.some((n) => n.key === "v13")).toBe(true);
      expect(review!.basepart).toBeNull();
    });
  });
