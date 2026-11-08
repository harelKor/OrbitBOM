// Runs against a real Postgres when TEST_DATABASE_URL is set. Onshape is a fake fetch.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

const DID = "4123456789abcdef01234567"; // the students' CAD document
const WID = "b9abcdef0123456789abcdef";
const EID = "cedcba9876543210fedcba98"; // its assembly
const S1 = "d00000000000000000000001";

if (!url) describe.skip("Follow versions and CAD Review comments (database): set TEST_DATABASE_URL", () => {});
else
  describe("Follow versions and CAD Review comments (database)", async () => {
    process.env.DATABASE_URL = url;
    process.env.ONSHAPE_TOKEN_KEY = randomBytes(32).toString("base64");
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { encrypt } = await import("@/lib/crypto");
    const { checkSystem } = await import("./detect");
    const { commitDraft } = await import("./commit");
    const { docVersionsKey } = await import("./docVersions");
    const { addComment, approveComment, rejectComment, tickComments, untickComment } = await import("@/lib/reviews/comments");
    const { loadSystemReview, reviewCounts } = await import("@/lib/data/cadReview");

    const onshape: string[] = [];
    let versions = [{ id: "v1", name: "V1", createdAt: "2026-11-01T10:00:00Z" }];
    vi.stubGlobal("fetch", async (input: string | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      const path = new URL(req.url).pathname.replace(/^\/api\/v\d+\//, "");
      onshape.push(`${req.method} ${path}`);
      const json = (b: unknown) => new Response(JSON.stringify(b));
      if (path.endsWith("/currentmicroversion")) return json({ microversion: "mv1" });
      if (path === `documents/d/${DID}/versions`) return json(versions);
      if (path.startsWith("assemblies/") && path.endsWith("/bom")) {
        const v = path.match(/\/v\/(\w+)\//)?.[1] ?? "?";
        return json({
          headers: [
            { id: "n", name: "Name" },
            { id: "q", name: "Quantity" },
          ],
          rows: [{ itemSource: { documentId: DID, elementId: S1, partId: "P1", wvmType: "v", wvmId: v }, headerIdToValue: { n: "Plate", q: 1 } }],
        });
      }
      return new Response("not found", { status: 404 });
    });

    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Review Tester", onshapeConnected: true, team: "cad" }).returning();
    const mentorUser = randomUUID();
    const [mentor] = await db.insert(schema.members).values({ userId: mentorUser, email: `${mentorUser}@t.org`, name: "Mentor", isMentor: true }).returning();
    const buildUser = randomUUID();
    const [builder] = await db.insert(schema.members).values({ userId: buildUser, email: `${buildUser}@t.org`, name: "Builder", team: "build" }).returning();
    await db.insert(schema.onshapeTokens).values({ memberId: member.id, accessTokenEnc: encrypt("access"), refreshTokenEnc: encrypt("refresh"), expiresAt: new Date(Date.now() + 3600_000) });
    const [robot] = await db.insert(schema.robots).values({ name: "Review bot", year: 2027 }).returning();
    const assemblyUrl = `https://cad.onshape.com/documents/${DID}/w/${WID}/e/${EID}`;
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Intake", assemblyUrl, followVersions: true }).returning();
    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      for (const m of [member, mentor, builder]) await db.delete(schema.members).where(eq(schema.members.id, m.id));
      await db.delete(schema.onshapeCache).where(eq(schema.onshapeCache.key, docVersionsKey(DID)));
    });

    it("a system that follows versions reads the newest version, not the workspace", async () => {
      onshape.length = 0;
      const first = await checkSystem(system.id, member.id);
      expect(first.draft?.changes.map((c) => c.name)).toEqual(["Plate"]);
      expect(onshape).toEqual([`GET documents/d/${DID}/versions`, expect.stringContaining(`assemblies/d/${DID}/v/v1/e/${EID}/bom`)]);
      await commitDraft(system.id, member.id, { draftId: first.draft!.id, seen: new Date(first.draft!.detectedAt).toISOString(), name: "" });

      // Students keep editing between versions: the next check stops after 1 call.
      onshape.length = 0;
      expect((await checkSystem(system.id, member.id, { force: false })).unchanged).toBe(true);
      expect(onshape).toEqual([`GET documents/d/${DID}/versions`]);
    });

    it("comments: anyone writes, the CAD Team ticks, a mentor approves or rejects", async () => {
      const a = await addComment(builder, { systemId: system.id, body: "Bolt too close to the edge", partKey: `${DID}:${S1}:P1`, partName: "Plate" });
      const b = await addComment(builder, { systemId: system.id, body: "Add a chamfer" });
      await expect(tickComments(builder, "build", system.id, [a.id])).rejects.toThrow("Only the CAD Team");
      expect(await tickComments(member, "cad", system.id, [a.id, b.id])).toBe(2);
      expect(await reviewCounts(robot.id)).toEqual({ [system.id]: { open: 0, done: 2 } });

      await expect(approveComment(member, a.id)).rejects.toThrow("Only mentors");
      await approveComment(mentor, a.id);
      await expect(rejectComment(mentor, b.id, " ")).rejects.toThrow("Write why");
      await rejectComment(mentor, b.id, "Still sharp");
      await expect(untickComment(member, "cad", a.id)).rejects.toThrow("already approved");

      const review = await loadSystemReview(system.id);
      const byId = new Map(review!.comments.map((c) => [c.id, c]));
      expect(byId.get(a.id)).toMatchObject({ state: "approved", approvedBy: "Mentor", author: "Builder", partName: "Plate" });
      expect(byId.get(b.id)).toMatchObject({ state: "open", rejectNote: "Still sharp", rejectedBy: "Mentor", doneAt: null });
    });

    it("the tree lists the kept Onshape versions and marks the one the BOM was updated to", async () => {
      // A new Onshape version the BOM isn't on yet; the check reads the list in its 1 call.
      versions = [...versions, { id: "v2", name: "V2", createdAt: "2099-01-01T10:00:00Z" }];
      await checkSystem(system.id, member.id, { force: false });
      const review = await loadSystemReview(system.id);
      expect(review!.tree.map((n) => [n.name, n.bom.length])).toEqual([
        ["V2", 0],
        ["V1", 1],
      ]);
      expect(review!.tree[1].bom[0].current).toBe(true);
      // Both comments were added and ticked while V1 was the newest version.
      expect(review!.tree[1].added).toHaveLength(2);
    });
  });
