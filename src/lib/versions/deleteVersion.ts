import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ModelKind } from "@/db/schema";
import { deleteSnapshot, snapKey, type FrozenRef } from "@/lib/model/snapshotStore";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { revertSystem } from "./history";
import { VersionError } from "./commit";

const { cadUpdates, deletedVersions, partVersions, parts, reviewComments, systems, systemVersions } = schema;

// Delete version (Harel, 2026-11-17): from OrbitParts only, since Onshape can't delete a version.
// The node goes from the tree with its sub-versions and saved 3D model; its comments fall to the
// version before it (the tree files them by date). Its BOM versions go too: a part state only
// that version had moves to the next version, so part history and Revert stay whole; the version
// the BOM is on is first reverted to the one before it. The only version left can't go.

export type VersionNode = {
  owner: { systemId: string } | { robotId: string };
  kind: ModelKind;
  did: string | null; // the tree's document, for an Onshape version
  vid: string | null; // its Onshape version
  bomIds: string[];
  subIds: string[]; // sub-versions: the node's own, or the one sub-version being deleted
  ref: FrozenRef | null;
};

export async function deleteVersion(node: VersionNode, memberId: string) {
  const ownerWhere = "systemId" in node.owner ? eq(cadUpdates.systemId, node.owner.systemId) : and(eq(cadUpdates.robotId, node.owner.robotId), isNull(cadUpdates.systemId));
  const systemId = "systemId" in node.owner ? node.owner.systemId : null;
  if (node.bomIds.length) {
    if (!systemId || node.kind !== "final") throw new VersionError("Only a system's Final has BOM versions.");
    for (const id of node.bomIds) await deleteBomVersion(systemId, id, memberId);
  }
  if (node.subIds.length) await db.delete(cadUpdates).where(and(ownerWhere, eq(cadUpdates.model, node.kind), inArray(cadUpdates.id, node.subIds)));
  if (node.vid && node.did) {
    // The version's own update and the sub-versions made on it.
    await db.delete(cadUpdates).where(and(ownerWhere, eq(cadUpdates.model, node.kind), eq(cadUpdates.onshapeVersionId, node.vid)));
    await db.delete(cadUpdates).where(and(ownerWhere, eq(cadUpdates.model, node.kind), eq(cadUpdates.parentVersionId, node.vid)));
    await db.insert(deletedVersions).values({ did: node.did, versionId: node.vid, memberId }).onConflictDoNothing();
  }
  if (node.ref) {
    const link = await modelLink(node);
    if (link?.eid) await deleteSnapshot(snapKey(node.kind, link, node.ref));
  }
}

async function modelLink(node: VersionNode) {
  if ("systemId" in node.owner) {
    const [s] = await db.select({ final: systems.assemblyUrl, basepart: systems.basepartUrl }).from(systems).where(eq(systems.id, node.owner.systemId));
    const url = node.kind === "final" ? s?.final : s?.basepart;
    return url ? parseOnshapeUrl(url) : null;
  }
  const [r] = await db.select({ url: schema.robots.basepartUrl }).from(schema.robots).where(eq(schema.robots.id, node.owner.robotId));
  return r?.url ? parseOnshapeUrl(r.url) : null;
}

async function deleteBomVersion(systemId: string, versionId: string, memberId: string) {
  const committed = and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "committed"));
  const [v] = await db.select().from(systemVersions).where(and(committed, eq(systemVersions.id, versionId)));
  if (!v) return; // already gone
  const seq = v.seq ?? 0;
  const [[before], [after], [system]] = await Promise.all([
    db.select().from(systemVersions).where(and(committed, lt(systemVersions.seq, seq))).orderBy(desc(systemVersions.seq)).limit(1),
    db.select().from(systemVersions).where(and(committed, gt(systemVersions.seq, seq))).orderBy(asc(systemVersions.seq)).limit(1),
    db.select({ current: systems.currentVersionId }).from(systems).where(eq(systems.id, systemId)),
  ]);
  if (!before && !after) throw new VersionError("This is the system's only BOM version, so it can't be deleted.");
  // The BOM is on it: back to the version before it first (Revert), or, for the first version, on
  // to the next one.
  const current = system?.current ? system.current === versionId : !after; // no pointer: the newest
  if (current) await revertSystem(systemId, (before ?? after)!.id, memberId);

  await db.transaction(async (tx) => {
    await tx.select({ id: systems.id }).from(systems).where(eq(systems.id, systemId)).for("update");
    const rows = await tx.select({ id: partVersions.id, partId: partVersions.partId }).from(partVersions).where(eq(partVersions.versionId, versionId));
    const nextHas = after ? new Set((await tx.select({ partId: partVersions.partId }).from(partVersions).where(eq(partVersions.versionId, after.id))).map((r) => r.partId)) : new Set<string>();
    // States the next version replaces go; a part must not be standing on one of them.
    const dropped = rows.filter((r) => !after || nextHas.has(r.partId)).map((r) => r.id);
    if (dropped.length) {
      const held = await tx.select({ name: sql<string>`coalesce(${parts.displayName}, ${parts.onshapeName}, ${parts.partNumber}, 'a part')` }).from(parts).where(inArray(parts.versionRowId, dropped));
      if (held.length) throw new VersionError(`${held.length} part${held.length === 1 ? " is" : "s are"} on this version's state (${held.slice(0, 3).map((p) => p.name).join(", ")}${held.length > 3 ? "…" : ""}). Update ${held.length === 1 ? "it" : "them"} to the latest first.`);
    }
    const kept = rows.filter((r) => after && !nextHas.has(r.partId)).map((r) => r.id);
    if (kept.length) await tx.update(partVersions).set({ versionId: after!.id }).where(inArray(partVersions.id, kept));
    // Comments ticked off in it move on with the version that has its states now.
    await tx.update(reviewComments).set({ doneVersionId: after?.id ?? before?.id ?? null }).where(eq(reviewComments.doneVersionId, versionId));
    await tx.delete(systemVersions).where(eq(systemVersions.id, versionId));
  });
}
