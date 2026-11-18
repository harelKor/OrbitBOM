import "server-only";
import type { Anchor } from "@/lib/reviews/anchor";
import { listDesignReviews, reviewName, type DesignReview } from "@/lib/reviews/designReviews";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { ViewState } from "@/components/viewer/viewState";
import { db, schema } from "@/db";
import type { Member } from "@/lib/auth";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import type { CommentStatus } from "@/lib/reviews/status";
import { buildTree, type FrozenRef, type TreeNode } from "@/lib/reviews/tree";
import { imageUrl } from "@/lib/storage/r2";
import { bomModelRef, listCadUpdates } from "@/lib/versions/cad";
import { listRobotVersions, type RobotVersionRow } from "@/lib/versions/robotVersions";
import { keptDocVersions } from "@/lib/versions/docVersions";
import type { ModelKind, Snip } from "@/db/schema";
import { primaryVersion, versionLabel } from "@/lib/versions/label";

const { designReviews, members, reviewCommentReplies, reviewComments, robots, systems, systemVersions } = schema;

// CAD Review's pages read the database only (plan/design-review.md): never Onshape.

export type ReviewComment = {
  id: string;
  systemId: string | null; // null: on the whole robot
  systemName: string | null;
  body: string;
  partKey: string | null;
  partName: string | null;
  onshapeVersionId: string | null;
  onshapeVersionName: string | null;
  state: CommentStatus;
  onItAt: string | null;
  onItBy: string | null; // who is on it
  createdAt: string;
  author: string | null;
  authorId: string | null;
  doneAt: string | null; // set To check
  doneBy: string | null;
  doneVersionId: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectNote: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  snip: (Snip & { url: string | null }) | null; // the picture's short-lived link
  view: ViewState | null; // the 3D view it was written in (S6)
  pin: [number, number, number] | null; // its point there, assembly mm
  anchor: Anchor | null; // the face / edge / corner it's about (Harel, 2026-11-18)
  // Its Design Review (Harel, 2026-11-18): its tag "DR · R7" and the State text it opens.
  designReview: { id: string; name: string; version: string | null; state: string; open: boolean } | null;
  model: ModelKind; // written on the Basepart or the Final 3D model (Harel, 2026-11-12)
  authorAvatar: string | null;
  editedAt: string | null;
  replies: CommentReply[]; // its thread, oldest first (Harel, 2026-11-13)
  // The version it is on, where Onshape shows a comment's branch (Harel, 2026-11-13): the version
  // tree's node it was added under (its Onshape version from the panel, else by its date).
  // `ahead`: newer than the version the BOM is on.
  version: { name: string; ahead: boolean } | null;
};

export type CommentReply = {
  id: string;
  body: string;
  author: string | null;
  authorId: string | null;
  authorAvatar: string | null;
  createdAt: string;
  editedAt: string | null;
  snip: (Snip & { url: string | null }) | null; // Harel, 2026-11-17
  partKey: string | null;
  partName: string | null;
};

// A system's comments, or with `robotId` every comment of the robot (its own and its systems').
export async function listComments(scope: string | { robotId: string }): Promise<ReviewComment[]> {
  const rows = await db
    .select({ c: reviewComments, systemName: systems.name, dr: { id: designReviews.id, seq: designReviews.seq, version: designReviews.versionLabel, state: designReviews.state, finishedAt: designReviews.finishedAt } })
    .from(reviewComments)
    .leftJoin(systems, eq(systems.id, reviewComments.systemId))
    .leftJoin(designReviews, eq(designReviews.id, reviewComments.designReviewId))
    .where(typeof scope === "string" ? eq(reviewComments.systemId, scope) : eq(reviewComments.robotId, scope.robotId))
    .orderBy(asc(reviewComments.createdAt))
    .then((r) => r.map(({ c, systemName, dr }) => ({ ...c, systemName, dr })));
  const replies = rows.length
    ? await db
        .select()
        .from(reviewCommentReplies)
        .where(inArray(reviewCommentReplies.commentId, rows.map((r) => r.id)))
        .orderBy(asc(reviewCommentReplies.createdAt))
    : [];
  const ids = [...new Set([...rows.flatMap((r) => [r.authorId, r.onItBy, r.doneBy, r.approvedBy, r.rejectedBy]), ...replies.map((r) => r.authorId)].filter((x): x is string => !!x))];
  const people = new Map((ids.length ? await db.select({ id: members.id, name: members.name, avatarUrl: members.avatarUrl }).from(members).where(inArray(members.id, ids)) : []).map((m) => [m.id, m]));
  const name = (id: string | null) => (id ? (people.get(id)?.name ?? null) : null);
  const avatar = (id: string | null) => (id ? (people.get(id)?.avatarUrl ?? null) : null);
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  const paths = [...rows, ...replies].flatMap((r) => (r.snip ? [r.snip.path] : []));
  const urls = new Map(await Promise.all(paths.map(async (p) => [p, await imageUrl(p)] as const)));
  const thread = new Map<string, CommentReply[]>();
  for (const r of replies) {
    const list = thread.get(r.commentId) ?? [];
    list.push({
      id: r.id,
      body: r.body,
      author: name(r.authorId),
      authorId: r.authorId,
      authorAvatar: avatar(r.authorId),
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      snip: r.snip ? { ...r.snip, url: urls.get(r.snip.path) ?? null } : null,
      partKey: r.partKey,
      partName: r.partName,
    });
    thread.set(r.commentId, list);
  }
  return rows.map((r) => ({
    id: r.id,
    systemId: r.systemId,
    systemName: r.systemName,
    body: r.body,
    partKey: r.partKey,
    partName: r.partName,
    onshapeVersionId: r.onshapeVersionId,
    onshapeVersionName: r.onshapeVersionName,
    state: r.state,
    onItAt: iso(r.onItAt),
    onItBy: name(r.onItBy),
    createdAt: r.createdAt.toISOString(),
    author: name(r.authorId),
    authorId: r.authorId,
    doneAt: iso(r.doneAt),
    doneBy: name(r.doneBy),
    doneVersionId: r.doneVersionId,
    approvedAt: iso(r.approvedAt),
    approvedBy: name(r.approvedBy),
    rejectNote: r.rejectNote,
    rejectedAt: iso(r.rejectedAt),
    rejectedBy: name(r.rejectedBy),
    snip: r.snip ? { ...r.snip, url: urls.get(r.snip.path) ?? null } : null,
    view: r.view ?? null,
    pin: r.pin ?? null,
    anchor: r.anchor ?? null,
    designReview: r.dr?.id ? { id: r.dr.id, name: reviewName(r.dr.seq), version: r.dr.version, state: r.dr.state, open: !r.dr.finishedAt } : null,
    model: r.model,
    authorAvatar: avatar(r.authorId),
    editedAt: iso(r.editedAt),
    replies: thread.get(r.id) ?? [],
    version: r.onshapeVersionId ? { name: r.onshapeVersionName || "Onshape version", ahead: false } : null,
  }));
}

export type SystemReview = {
  comments: ReviewComment[];
  tree: TreeNode[];
  // Where the tree's Onshape versions come from: the document, and when they were last read
  // (null: never, so the tree shows the BOM's versions only).
  treeDid: string | null;
  treeReadAt: string | null;
  // Parts the current BOM version changed, by Onshape part id key, for the 3D Compare.
  changes: { partId: string | null; change: string; geometry: boolean; name: string }[];
  current: { id: string; label: string } | null;
  // Where the 3D model is read now (as the model build reads it), for Compare and the tree.
  modelRef: FrozenRef | null;
  // The Basepart's own tree (Harel, 2026-11-13), when the system has a Basepart.
  basepart: BasepartTree | null;
};

// A Basepart's version tree: its document's Onshape versions from its first update on, its
// updates' sub-versions, and the comments written on the Basepart model. No BOM marks.
export type BasepartTree = { tree: TreeNode[]; treeDid: string | null; treeReadAt: string | null; modelRef: FrozenRef | null };

async function basepartTree(owner: { systemId: string } | { robotId: string }, url: string | null, comments: ReviewComment[], pinned: FrozenRef | null = null): Promise<BasepartTree | null> {
  const ref = url ? parseOnshapeUrl(url) : null;
  if (!ref) return null;
  const [kept, updates, deleted] = await Promise.all([keptDocVersions(ref.did), listCadUpdates(owner, "basepart"), deletedIn(ref.did)]);
  const tree = buildTree(
    kept?.versions ?? null,
    [],
    comments.filter((c) => c.model === "basepart").map(treeComment),
    { since: updates.first, cad: updates.subs.map((u) => ({ ...u, ref: u.did === ref.did ? u.ref : null })), ownDoc: true, deleted },
  );
  return { tree, treeDid: ref.did, treeReadAt: kept?.at.toISOString() ?? null, modelRef: pinned };
}

// Onshape versions of a document deleted from OrbitParts (Harel, 2026-11-17).
async function deletedIn(did: string | null): Promise<Set<string>> {
  if (!did) return new Set();
  const rows = await db.select({ v: schema.deletedVersions.versionId }).from(schema.deletedVersions).where(eq(schema.deletedVersions.did, did));
  return new Set(rows.map((r) => r.v));
}

const treeComment = (c: ReviewComment) => ({ id: c.id, createdAt: c.createdAt, doneAt: c.doneAt, doneVersionId: c.doneVersionId, state: c.state, onshapeVersionId: c.onshapeVersionId, onshapeVersionName: c.onshapeVersionName });

// Each comment's version chip: the tree node it was added under. `bom`: the tree has BOM marks,
// so "ahead" means newer than the BOM (a Basepart's tree has none).
function markVersions(comments: ReviewComment[], tree: TreeNode[], bom: boolean) {
  const byId = new Map(comments.map((c) => [c.id, c]));
  for (const node of tree)
    for (const id of node.added) {
      const c = byId.get(id);
      if (c) c.version = { name: node.name, ahead: bom && node.ahead };
    }
}

// `comments`: the system's comments when the caller already has them (the robot's CAD page reads
// every comment of the robot once). `changes: false` skips what the current version changed, for
// pages that show only the comments (the Onshape panel).
export async function loadSystemReview(systemId: string, opts: { comments?: ReviewComment[]; changes?: boolean } = {}): Promise<SystemReview | null> {
  const [system] = await db
    .select({
      assemblyUrl: systems.assemblyUrl,
      basepartUrl: systems.basepartUrl,
      followVersions: systems.followVersions,
      followedVersionId: systems.followedVersionId,
      currentVersionId: systems.currentVersionId,
      modelRef: systems.modelRef,
      basepartModelRef: systems.basepartModelRef,
    })
    .from(systems)
    .where(eq(systems.id, systemId));
  if (!system) return null;
  const [versions, comments, cad] = await Promise.all([
    // Only what the tree needs: each version's `changes` and `rows` JSON can be large, and only
    // the current one's changes are shown (read below).
    db
      .select({ v: { id: systemVersions.id, seq: systemVersions.seq, onshapeRef: systemVersions.onshapeRef, committedAt: systemVersions.committedAt }, by: members.name })
      .from(systemVersions)
      .leftJoin(members, eq(members.id, systemVersions.committedBy))
      .where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "committed")))
      .orderBy(desc(systemVersions.seq)),
    opts.comments ?? listComments(systemId),
    listCadUpdates({ systemId }, "final"),
  ]);
  const currentId = system.currentVersionId ?? versions[0]?.v.id ?? null;
  const current = versions.find((x) => x.v.id === currentId)?.v ?? null;
  const changesRead =
    current && opts.changes !== false ? db.select({ changes: systemVersions.changes }).from(systemVersions).where(eq(systemVersions.id, current.id)).then(([r]) => r?.changes ?? []) : Promise.resolve([]);
  // The design's own document: the assembly's when the system follows its versions, else the
  // document most of its BOM comes from (the CAD document inserted in a Manufacture assembly).
  const asm = system.assemblyUrl ? parseOnshapeUrl(system.assemblyUrl) : null;
  const treeDid = system.followVersions ? (asm?.did ?? null) : (primaryVersion(current?.onshapeRef)?.[0] ?? asm?.did ?? null);
  const [kept, deleted] = await Promise.all([treeDid ? keptDocVersions(treeDid) : null, deletedIn(treeDid)]);
  const vidOf = (ref: (typeof versions)[number]["v"]["onshapeRef"]) => {
    if (!ref) return null;
    if (ref.vid) return ref.vid;
    const main = primaryVersion(ref);
    return main && main[0] === treeDid ? main[1].versionId : null;
  };
  const tree = buildTree(
    kept?.versions ?? null,
    versions.map(({ v, by }) => ({ id: v.id, label: versionLabel(v), at: v.committedAt?.toISOString() ?? null, by, vid: vidOf(v.onshapeRef), current: v.id === currentId, ref: asm ? bomModelRef(v.onshapeRef, asm.did) : null })),
    // The Final's tree holds the comments written on the Final model (Harel, 2026-11-13).
    comments.filter((c) => c.model !== "basepart").map(treeComment),
    // The tree starts at the system's first sync (Harel, 2026-11-11): its first BOM version.
    {
      since: versions.reduce<string | null>((a, { v }) => (v.committedAt && (!a || v.committedAt.toISOString() < a) ? v.committedAt.toISOString() : a), null),
      cad: cad.subs.map((u) => ({ ...u, ref: asm && u.did === asm.did ? u.ref : null })),
      ownDoc: !!asm && treeDid === asm.did,
      deleted,
    },
  );
  markVersions(comments, tree, true);
  const basepart = await basepartTree({ systemId }, system.basepartUrl, comments, system.basepartModelRef ?? null);
  // As modelSources reads it: pinned by the last Update CAD, else a followed system's version.
  const followed = system.followVersions ? (current?.onshapeRef?.vid ?? system.followedVersionId) : null;
  const modelRef: FrozenRef | null = system.modelRef ?? (followed ? { wvm: "v", wvmid: followed } : null);
  if (basepart) markVersions(comments, basepart.tree, false);
  return {
    comments,
    tree,
    treeDid,
    treeReadAt: kept?.at.toISOString() ?? null,
    changes: ((await changesRead) ?? []).map((c) => ({ partId: c.partId ?? null, change: c.change, geometry: !!c.geometry, name: c.name })),
    current: current ? { id: current.id, label: versionLabel(current) } : null,
    modelRef,
    basepart,
  };
}

// Per system of a robot ("robot": those on the whole robot): `open` the ones still to act on (Open,
// On it), `done` the ones To check (waiting for a mentor).
export async function reviewCounts(robotId: string): Promise<Record<string, { open: number; done: number }>> {
  const rows = await db
    .select({ systemId: reviewComments.systemId, state: reviewComments.state, n: count() })
    .from(reviewComments)
    .where(and(eq(reviewComments.robotId, robotId), inArray(reviewComments.state, ["open", "on_it", "to_check"])))
    .groupBy(reviewComments.systemId, reviewComments.state);
  const out: Record<string, { open: number; done: number }> = {};
  for (const r of rows) {
    const c = (out[r.systemId ?? "robot"] ??= { open: 0, done: 0 });
    if (r.state === "to_check") c.done += r.n;
    else c.open += r.n;
  }
  return out;
}

// The home card's badge: for a mentor the To check comments waiting for them, for a CAD Team
// member the Open and On it comments on their own system.
export async function waitingOnYou(member: Member, robotId: string | null): Promise<number> {
  if (member.isMentor && robotId) {
    const counts = await reviewCounts(robotId);
    return Object.values(counts).reduce((n, c) => n + c.done, 0);
  }
  if (member.team === "cad" && member.systemId) {
    const [row] = await db.select({ n: count() }).from(reviewComments).where(and(eq(reviewComments.systemId, member.systemId), inArray(reviewComments.state, ["open", "on_it"])));
    return row?.n ?? 0;
  }
  return 0;
}

// The robot's CAD page (Harel, 2026-11-09): every comment of the robot, and each linked system's
// version tree and what its current version changed (shown when the page isolates the system).
// `final`: the system has a Final assembly (its tree is `tree`); `basepart` its Basepart's tree.
// `robotBasepart`: the robot's own Basepart's tree.
export type RobotReview = {
  comments: ReviewComment[];
  systems: ({ id: string; name: string; final: boolean } & Omit<SystemReview, "comments">)[];
  robotBasepart: BasepartTree | null;
  // The whole robot's own versions (Create version, Harel 2026-11-17), newest first, as a tree
  // with the comments on the whole robot filed under them by date.
  robotVersions: RobotVersionRow[];
  robotTree: TreeNode[];
  designReviews: DesignReview[]; // newest first (Harel, 2026-11-18)
};

export async function loadRobotReview(robotId: string, opts: { changes?: boolean } = {}): Promise<RobotReview> {
  const [rows, comments, [robot]] = await Promise.all([
    db.select({ id: systems.id, name: systems.name, url: systems.assemblyUrl, basepart: systems.basepartUrl }).from(systems).where(eq(systems.robotId, robotId)).orderBy(asc(systems.name)),
    listComments({ robotId }),
    db.select({ basepart: robots.basepartUrl, pinned: robots.basepartModelRef }).from(robots).where(eq(robots.id, robotId)),
  ]);
  const linked = rows.filter((r) => r.url || r.basepart);
  // Each system's tree marks its own comments' versions on these same objects (no second read
  // of the comments per system).
  const reviews = await Promise.all(linked.map((r) => loadSystemReview(r.id, { comments: comments.filter((c) => c.systemId === r.id), changes: opts.changes })));
  const [robotBasepart, robotVersions, designReviews] = await Promise.all([basepartTree({ robotId }, robot?.basepart ?? null, comments.filter((c) => !c.systemId), robot?.pinned ?? null), listRobotVersions(robotId), listDesignReviews(robotId)]);
  if (robotBasepart) markVersions(comments, robotBasepart.tree, false);
  const robotTree = buildTree(
    robotVersions.map((v) => ({ id: `rv:${v.id}`, name: v.name, createdAt: v.at, creator: v.by, description: v.note })),
    [],
    comments.filter((c) => !c.systemId && c.model !== "basepart").map(treeComment),
  );
  markVersions(comments, robotTree, false);
  return {
    comments,
    systems: linked.map((r, i) => {
      const s = reviews[i];
      return { id: r.id, name: r.name, final: !!r.url, tree: s?.tree ?? [], treeDid: s?.treeDid ?? null, treeReadAt: s?.treeReadAt ?? null, changes: s?.changes ?? [], current: s?.current ?? null, modelRef: s?.modelRef ?? null, basepart: s?.basepart ?? null };
    }),
    robotBasepart,
    robotVersions,
    robotTree,
    designReviews,
  };
}
