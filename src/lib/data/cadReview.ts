import "server-only";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Member } from "@/lib/auth";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { buildTree, type TreeNode } from "@/lib/reviews/tree";
import { keptDocVersions } from "@/lib/versions/docVersions";
import { primaryVersion, versionLabel } from "@/lib/versions/label";

const { members, reviewComments, systems, systemVersions } = schema;

// CAD Review's pages read the database only (plan/design-review.md): never Onshape.

export type ReviewComment = {
  id: string;
  body: string;
  partKey: string | null;
  partName: string | null;
  state: "open" | "done" | "approved";
  createdAt: string;
  author: string | null;
  authorId: string | null;
  doneAt: string | null;
  doneBy: string | null;
  doneVersionId: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectNote: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
};

export async function listComments(systemId: string): Promise<ReviewComment[]> {
  const rows = await db.select().from(reviewComments).where(eq(reviewComments.systemId, systemId)).orderBy(asc(reviewComments.createdAt));
  const ids = [...new Set(rows.flatMap((r) => [r.authorId, r.doneBy, r.approvedBy, r.rejectedBy]).filter((x): x is string => !!x))];
  const names = new Map((ids.length ? await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, ids)) : []).map((m) => [m.id, m.name]));
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    partKey: r.partKey,
    partName: r.partName,
    state: r.state,
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
};

export async function loadSystemReview(systemId: string): Promise<SystemReview | null> {
  const [system] = await db
    .select({ assemblyUrl: systems.assemblyUrl, followVersions: systems.followVersions, currentVersionId: systems.currentVersionId })
    .from(systems)
    .where(eq(systems.id, systemId));
  if (!system) return null;
  const [versions, comments] = await Promise.all([
    db
      .select({ v: systemVersions, by: members.name })
      .from(systemVersions)
      .leftJoin(members, eq(members.id, systemVersions.committedBy))
      .where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "committed")))
      .orderBy(desc(systemVersions.seq)),
    listComments(systemId),
  ]);
  const currentId = system.currentVersionId ?? versions[0]?.v.id ?? null;
  const current = versions.find((x) => x.v.id === currentId)?.v ?? null;
  // The design's own document: the assembly's when the system follows its versions, else the
  // document most of its BOM comes from (the CAD document inserted in a Manufacture assembly).
  const asm = system.assemblyUrl ? parseOnshapeUrl(system.assemblyUrl) : null;
  const treeDid = system.followVersions ? (asm?.did ?? null) : (primaryVersion(current?.onshapeRef)?.[0] ?? asm?.did ?? null);
  const kept = treeDid ? await keptDocVersions(treeDid) : null;
  const vidOf = (ref: (typeof versions)[number]["v"]["onshapeRef"]) => {
    if (!ref) return null;
    if (ref.vid) return ref.vid;
    const main = primaryVersion(ref);
    return main && main[0] === treeDid ? main[1].versionId : null;
  };
  const tree = buildTree(
    kept?.versions ?? null,
    versions.map(({ v, by }) => ({ id: v.id, label: versionLabel(v), at: v.committedAt?.toISOString() ?? null, by, vid: vidOf(v.onshapeRef), current: v.id === currentId })),
    comments.map((c) => ({ id: c.id, createdAt: c.createdAt, doneAt: c.doneAt, doneVersionId: c.doneVersionId, state: c.state })),
  );
  return {
    comments,
    tree,
    treeDid,
    treeReadAt: kept?.at.toISOString() ?? null,
    changes: (current?.changes ?? []).map((c) => ({ partId: c.partId ?? null, change: c.change, geometry: !!c.geometry, name: c.name })),
    current: current ? { id: current.id, label: versionLabel(current) } : null,
  };
}

// Open and ticked-off (waiting for a mentor) comments per system of a robot.
export async function reviewCounts(robotId: string): Promise<Record<string, { open: number; done: number }>> {
  const rows = await db
    .select({ systemId: reviewComments.systemId, state: reviewComments.state, n: count() })
    .from(reviewComments)
    .innerJoin(systems, eq(systems.id, reviewComments.systemId))
    .where(and(eq(systems.robotId, robotId), inArray(reviewComments.state, ["open", "done"])))
    .groupBy(reviewComments.systemId, reviewComments.state);
  const out: Record<string, { open: number; done: number }> = {};
  for (const r of rows) {
    const c = (out[r.systemId] ??= { open: 0, done: 0 });
    if (r.state === "open") c.open = r.n;
    else c.done = r.n;
  }
  return out;
}

// The home card's badge: for a mentor the ticked-off comments waiting for them, for a CAD Team
// member the open comments on their own system.
export async function waitingOnYou(member: Member, robotId: string | null): Promise<number> {
  if (member.isMentor && robotId) {
    const counts = await reviewCounts(robotId);
    return Object.values(counts).reduce((n, c) => n + c.done, 0);
  }
  if (member.team === "cad" && member.systemId) {
    const [row] = await db.select({ n: count() }).from(reviewComments).where(and(eq(reviewComments.systemId, member.systemId), eq(reviewComments.state, "open")));
    return row?.n ?? 0;
  }
  return 0;
}
