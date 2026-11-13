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
    const { addComment, saveSnipLines, setCommentStatus, tickComments } = await import("@/lib/reviews/comments");
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
      // The list, the BOM, and the parts' shapes stored at the first sync (revisions, mass properties).
      expect(onshape).toEqual([
        `GET documents/d/${DID}/versions`,
        expect.stringContaining(`assemblies/d/${DID}/v/v1/e/${EID}/bom`),
        expect.stringContaining(`documents/d/${DID}/v/v1/elements`),
        expect.stringContaining(`/massproperties`),
      ]);
      await commitDraft(system.id, member.id, { draftId: first.draft!.id, seen: new Date(first.draft!.detectedAt).toISOString(), name: "" });

      // Students keep editing between versions: the next check stops after 1 call.
      onshape.length = 0;
      expect((await checkSystem(system.id, member.id, { force: false })).unchanged).toBe(true);
      expect(onshape).toEqual([`GET documents/d/${DID}/versions`]);
    });

    it("comment statuses: Open, On it, To check (the commit's ticks), Done by a mentor; sent back with why", async () => {
      const a = await addComment(builder, { systemId: system.id, body: "Bolt too close to the edge", partKey: `${DID}:${S1}:P1`, partName: "Plate" });
      const b = await addComment(builder, { systemId: system.id, body: "Add a chamfer" });
      // Its author takes it on; someone who is neither the author nor the CAD Team can't.
      await setCommentStatus(builder, "build", a.id, "on_it");
      await expect(setCommentStatus(member, "none", b.id, "on_it")).rejects.toThrow("Only the CAD Team or its author");
      await expect(tickComments(builder, "build", system.id, [a.id])).rejects.toThrow("Only the CAD Team");
      expect(await tickComments(member, "cad", system.id, [a.id, b.id])).toBe(2);
      expect((await reviewCounts(robot.id))[system.id]).toEqual({ open: 0, done: 2 });

      await expect(setCommentStatus(member, "cad", a.id, "done")).rejects.toThrow("Only a mentor");
      await setCommentStatus(mentor, "none", a.id, "done");
      await expect(setCommentStatus(mentor, "none", b.id, "open", " ")).rejects.toThrow("Write why");
      await setCommentStatus(mentor, "none", b.id, "open", "Still sharp");
      await expect(setCommentStatus(member, "cad", a.id, "open")).rejects.toThrow("Only a mentor");

      // An admin in Edit mode sets Done like a mentor, straight from Open (Harel, 2026-11-13).
      const c = await addComment(builder, { systemId: system.id, body: "Label the wires" });
      await setCommentStatus(builder, "edit", c.id, "done");

      const review = await loadSystemReview(system.id);
      const byId = new Map(review!.comments.map((c) => [c.id, c]));
      expect(byId.get(a.id)).toMatchObject({ state: "done", approvedBy: "Mentor", onItBy: "Builder", author: "Builder", partName: "Plate" });
      expect(byId.get(b.id)).toMatchObject({ state: "open", rejectNote: "Still sharp", rejectedBy: "Mentor", doneAt: null });
      expect(byId.get(c.id)).toMatchObject({ state: "done", approvedBy: "Builder" });
    });

    it("comments on the whole robot: listed with the robot, counted apart from its systems", async () => {
      const r = await addComment(builder, { robotId: robot.id, systemId: null, body: "Bumpers clash with the intake" });
      expect(r.systemId).toBeNull();
      expect(r.robotId).toBe(robot.id);
      const { loadRobotReview } = await import("@/lib/data/cadReview");
      const all = await loadRobotReview(robot.id);
      expect(all.comments.find((c) => c.id === r.id)).toMatchObject({ systemId: null, systemName: null });
      expect(all.systems.map((s) => s.name)).toEqual(["Intake"]);
      expect((await reviewCounts(robot.id)).robot).toEqual({ open: 1, done: 0 });
      // A system comment from the robot's page lands on the robot that system belongs to.
      const other = await db.insert(schema.robots).values({ name: "Other bot", year: 2027 }).returning();
      await expect(addComment(builder, { robotId: other[0].id, systemId: system.id, body: "x" })).rejects.toThrow("That system is gone.");
      await db.delete(schema.robots).where(eq(schema.robots.id, other[0].id));
    });

    it("a snip: the author's lines saved with the comment, others add theirs and are tagged", async () => {
      await expect(addComment(builder, { systemId: system.id, body: "Look here", snip: { path: "elsewhere/x.jpg", w: 100, h: 80, strokes: [] } })).rejects.toThrow("didn't upload");
      const path = `review-snips/${randomUUID()}.jpg`;
      const c = await addComment(builder, { systemId: system.id, body: "Look here", snip: { path, w: 100, h: 80, strokes: [{ c: "#ef4444", s: 3, p: [1, 1, 50, 40], by: "forged" }] } });
      expect(c.snip).toMatchObject({ path, w: 100, h: 80, strokes: [{ by: builder.id, c: "#ef4444", s: 3, p: [1, 1, 50, 40] }], changed: [] });
      await saveSnipLines(member, c.id, { own: [{ c: "#3b82f6", s: 2, p: [5, 5, 9, 9] }] });
      const { listComments } = await import("@/lib/data/cadReview");
      const saved = (await listComments(system.id)).find((x) => x.id === c.id)!;
      expect(saved.snip!.strokes.map((s) => s.by)).toEqual([builder.id, member.id]);
      expect(saved.snip!.changed?.map((x) => x.name)).toEqual(["Review Tester"]);
      // Someone else can't erase the author's line: it stays whatever they send.
      await saveSnipLines(mentor, c.id, { own: [] });
      expect((await listComments(system.id)).find((x) => x.id === c.id)!.snip!.strokes).toHaveLength(2);
      await db.delete(schema.reviewComments).where(eq(schema.reviewComments.id, c.id));
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
      // The comments were added while V1 was the newest version.
      expect(review!.tree[1].added).toHaveLength(3);
    });

    it("an Onshape panel comment goes on Onshape's newest version, above the BOM's, with no extra call", async () => {
      const { panelVersion } = await import("@/lib/reviews/panelVersion");
      onshape.length = 0;
      // On the workspace: the newest version. The check above just read the list, so no call.
      const at = await panelVersion(member, system.id, { did: DID, wv: "w", wvId: WID });
      expect(at).toMatchObject({ version: { id: "v2", name: "V2" }, ahead: true, note: null });
      expect(onshape).toEqual([]);
      // Written now, so its date alone would put it on V1; its version puts it on V2.
      const c = await addComment(builder, { systemId: system.id, body: "Panel comment", onshapeVersion: at!.version });
      const review = await loadSystemReview(system.id);
      expect(review!.tree[0]).toMatchObject({ key: "v2", ahead: true });
      expect(review!.tree[0].added).toEqual([c.id]);
      expect(review!.comments.find((x) => x.id === c.id)).toMatchObject({ onshapeVersionId: "v2", onshapeVersionName: "V2" });
    });
  });
