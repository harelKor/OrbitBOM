import "server-only";
import { randomUUID } from "node:crypto";
import { and, count, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ModelKind } from "@/db/schema";
import { adoptGroupPlan, planGroupNow, runJobs, type GroupPlan, type ModelOwner } from "@/lib/model/build";
import { logCalls, onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { cachedPayloads, keepPayload } from "@/lib/onshape/studioRevs";
import { parseOnshapeUrl, type OnshapeRef } from "@/lib/onshape/url";
import { comparePlans, settleCandidates, sortChanges, type CadChange } from "./cadDiff";
import { addKeptVersion, keptDocVersions, nextVersionName, readDocVersions } from "./docVersions";
import { shapeFingerprints, shapeKey, sigsKey } from "./shape";

const { cadUpdates, onshapeCache, robots, systems, systemVersions } = schema;

// Update CAD (a system's Final) and Update Basepart (a system's or the robot's own Basepart) in
// the Onshape panel (Harel, 2026-11-11, 2026-11-13). First a check: the model as it is now in
// Onshape, pinned to the workspace's microversion, compared with what the 3D model has; the
// Commit window lists the parts added, removed and changed. Commit then makes that state the
// model's: a new Onshape version when "Create version" is ticked, else a sub-version "V12 v1" of
// the newest Onshape version; and a node of that model's version tree. Calls: the microversion,
// the definition or parts list, the Part Studio revisions (2–4), 1 mass-properties read per
// changed Part Studio, and the changed Part Studios' meshes for the previews, which the rebuild
// then reuses. Commit: +1 for a stale version list, +1 for a new version.

export type CadDraft = {
  id: string;
  kind: ModelKind;
  owner: ModelOwner;
  robotId: string;
  workspace: { did: string; wvmid: string; baseUrl: string };
  microversion: string;
  plan: GroupPlan;
  changes: CadChange[];
  at: string;
};

const draftKey = (kind: ModelKind, owner: ModelOwner) => `cad-draft:${kind}:${"systemId" in owner ? owner.systemId : `robot:${owner.robotId}`}`;
const FRESH_MS = 2 * 60_000;

// The owner's robot and the workspace link of its model.
async function ownerLink(kind: ModelKind, owner: ModelOwner): Promise<{ robotId: string; link: OnshapeRef | null }> {
  if ("systemId" in owner) {
    const [s] = await db.select({ robotId: systems.robotId, final: systems.assemblyUrl, basepart: systems.basepartUrl }).from(systems).where(eq(systems.id, owner.systemId));
    if (!s) throw new OnshapeError("System not found.");
    const url = kind === "final" ? s.final : s.basepart;
    return { robotId: s.robotId, link: url ? parseOnshapeUrl(url) : null };
  }
  const [r] = await db.select({ url: robots.basepartUrl }).from(robots).where(eq(robots.id, owner.robotId));
  if (!r) throw new OnshapeError("Robot not found.");
  return { robotId: owner.robotId, link: r.url ? parseOnshapeUrl(r.url) : null };
}

const isFrozen = (path: string) => /^d\/[^/]+\/[vm]\//.test(path);

export async function checkModelUpdate(kind: ModelKind, owner: ModelOwner, memberId: string): Promise<CadDraft & { calls: number }> {
  const { robotId, link } = await ownerLink(kind, owner);
  if (!link?.eid) throw new OnshapeError(kind === "final" ? "This system has no Onshape assembly URL." : "No Basepart is linked here.");
  const client = onshapeClient(memberId, link.baseUrl);
  try {
    const { plan, old, microversion } = await planGroupNow(client, robotId, kind, owner, link);
    const { changes, candidates } = comparePlans(old, plan);

    // Parts whose Part Studio file changed: same shape (another part of it moved) or not.
    const partIdOf = (k: string) => k.slice(k.lastIndexOf(":") + 1);
    const group = (list: { path: string; k: string }[]) => {
      const m = new Map<string, string[]>();
      for (const { path, k } of list) m.set(path, [...(m.get(path) ?? []), partIdOf(k)]);
      return m;
    };
    const afterSigs = await shapeFingerprints(client, group(candidates.map((c) => ({ path: c.after.path, k: c.k }))));
    const frozenBefore = candidates.filter((c) => isFrozen(c.before.path));
    const beforeSigs = await shapeFingerprints(client, group(frozenBefore.map((c) => ({ path: c.before.path, k: c.k }))));
    // A workspace read before can't be read again: what was kept under its revision, if anything.
    const kept = await cachedPayloads<Record<string, string>>(candidates.flatMap((c) => (!isFrozen(c.before.path) && c.before.state ? [sigsKey(c.before.state)] : [])));
    const sigOf = (sigs: Record<string, string>, k: string) => {
      const [did, eid, partId] = k.split(":");
      return sigs[shapeKey(did, eid, partId)];
    };
    const sigs = { before: {} as Record<string, string>, after: {} as Record<string, string> };
    for (const c of candidates) {
      const a = sigOf(afterSigs, c.k);
      const b = isFrozen(c.before.path) ? sigOf(beforeSigs, c.k) : c.before.state ? kept.get(sigsKey(c.before.state))?.[partIdOf(c.k)] : undefined;
      if (a) sigs.after[c.k] = a;
      if (b) sigs.before[c.k] = b;
    }
    const all = sortChanges([...changes, ...settleCandidates(old, plan, candidates, sigs)]);

    // The new Part Studio files the previews show (the rebuild after the commit reuses them).
    const needed = new Set(all.flatMap((c) => (c.after ? [c.after.file] : [])));
    const jobs = plan.jobs.filter((j) => needed.has(j.key) && !j.sketches).map((j) => ({ ...j }));
    if (jobs.length) await runJobs(client, { jobs }, Date.now() + 120_000);

    const draft: CadDraft = {
      id: randomUUID(),
      kind,
      owner,
      robotId,
      workspace: { did: link.did, wvmid: link.wvmid, baseUrl: link.baseUrl },
      microversion,
      plan,
      changes: all,
      at: new Date().toISOString(),
    };
    await keepPayload(draftKey(kind, owner), draft);
    return { ...draft, calls: client.calls };
  } finally {
    logCalls(kind === "final" ? "check-cad" : "check-basepart", client);
  }
}

export type CadCommitResult = { label: string; robotId: string; calls: number };

// Makes the checked state the model's (see above). `draftId`: the check the member reviewed; a
// newer check replaces it.
export async function commitModelUpdate(kind: ModelKind, owner: ModelOwner, draftId: string, memberId: string, { makeVersion, name }: { makeVersion: boolean; name?: string }): Promise<CadCommitResult> {
  const key = draftKey(kind, owner);
  const draft = (await cachedPayloads<CadDraft>([key])).get(key);
  if (!draft || draft.id !== draftId) throw new OnshapeError("This check was replaced by a newer one. Check again.");
  const { did, wvmid, baseUrl } = draft.workspace;
  const client = onshapeClient(memberId, baseUrl);
  const ownerCols = "systemId" in owner ? { systemId: owner.systemId } : { robotId: owner.robotId };
  try {
    let kept = await keptDocVersions(did);
    const versions = makeVersion || !kept || Date.now() - kept.at.getTime() > FRESH_MS ? await readDocVersions(client, did) : kept.versions;
    let label: string;
    let pin: { wvm: "v" | "m"; wvmid: string };
    if (makeVersion) {
      const typed = name?.trim().slice(0, 120);
      const wanted = typed || nextVersionName(versions);
      const made = await client.json<{ id: string; name?: string; createdAt?: string; creator?: { name?: string } }>(`documents/d/${did}/versions`, {
        method: "POST",
        body: JSON.stringify({ documentId: did, workspaceId: wvmid, name: wanted, microversionId: draft.microversion }),
      });
      label = made.name ?? wanted;
      await addKeptVersion(did, { ...made, name: label });
      await db.insert(cadUpdates).values({ ...ownerCols, model: kind, did, microversion: draft.microversion, onshapeVersionId: made.id, label, memberId });
      pin = { wvm: "v", wvmid: made.id };
    } else {
      kept = await keptDocVersions(did);
      const list = kept?.versions ?? [];
      const parent = list.reduce<(typeof list)[number] | null>((a, v) => (!a || v.createdAt > a.createdAt ? v : a), null);
      if (!parent) throw new OnshapeError("This document has no Onshape version yet: tick Create version for the first one.");
      const [{ n }] = await db
        .select({ n: count() })
        .from(cadUpdates)
        .where(and(ownerWhere(owner), eq(cadUpdates.model, kind), eq(cadUpdates.parentVersionId, parent.id), isNull(cadUpdates.onshapeVersionId)));
      label = `${parent.name} v${n + 1}`;
      await db.insert(cadUpdates).values({ ...ownerCols, model: kind, did, microversion: draft.microversion, parentVersionId: parent.id, label, memberId });
      pin = { wvm: "m", wvmid: draft.microversion };
    }
    await pinModel(kind, owner, pin);
    await adoptGroupPlan(draft.robotId, kind, owner, draft.plan);
    await db.delete(onshapeCache).where(eq(onshapeCache.key, key));
    return { label, robotId: draft.robotId, calls: client.calls };
  } finally {
    logCalls(kind === "final" ? "commit-cad" : "commit-basepart", client);
  }
}

const ownerWhere = (owner: ModelOwner) => ("systemId" in owner ? eq(cadUpdates.systemId, owner.systemId) : and(eq(cadUpdates.robotId, owner.robotId), isNull(cadUpdates.systemId)));

async function pinModel(kind: ModelKind, owner: ModelOwner, ref: { wvm: "v" | "m"; wvmid: string }) {
  if ("systemId" in owner) {
    await db
      .update(systems)
      .set(kind === "final" ? { modelRef: ref } : { basepartModelRef: ref })
      .where(eq(systems.id, owner.systemId));
  } else await db.update(robots).set({ basepartModelRef: ref }).where(eq(robots.id, owner.robotId));
}

// Update BOM with "Update 3D views" ticked: the 3D moves to the state the BOM version was read
// at (its Onshape version, or the microversion the check read). A database write only; the
// rebuild that follows reads only this system's assembly. Returns the robot to rebuild.
export async function pinModelToVersion(systemId: string, versionId: string): Promise<string | null> {
  const [row] = await db
    .select({ ref: systemVersions.onshapeRef, url: systems.assemblyUrl, robotId: systems.robotId })
    .from(systemVersions)
    .innerJoin(systems, eq(systems.id, systemVersions.systemId))
    .where(eq(systemVersions.id, versionId));
  const asm = row?.url ? parseOnshapeUrl(row.url) : null;
  if (!row || !asm || !row.ref) return row?.robotId ?? null;
  // The assembly document's own version (a BOM release or a followed version), else the
  // microversion the check read.
  const own = row.ref.sources?.[asm.did]?.versionId ?? (row.ref.did === asm.did ? row.ref.vid : undefined);
  const modelRef = own ? { wvm: "v" as const, wvmid: own } : row.ref.mv && row.ref.did === asm.did ? { wvm: "m" as const, wvmid: row.ref.mv } : null;
  if (modelRef) await pinModel("final", { systemId }, modelRef);
  return row.robotId;
}

// A model's updates for its version tree: sub-versions (no Onshape version of their own) and when
// the first update was made (the Basepart tree starts there).
export async function listCadUpdates(owner: ModelOwner, kind: ModelKind) {
  const rows = await db
    .select({ id: cadUpdates.id, parentVid: cadUpdates.parentVersionId, version: cadUpdates.onshapeVersionId, label: cadUpdates.label, at: cadUpdates.createdAt, by: schema.members.name })
    .from(cadUpdates)
    .leftJoin(schema.members, eq(schema.members.id, cadUpdates.memberId))
    .where(and(ownerWhere(owner), eq(cadUpdates.model, kind)));
  const subs = rows.filter((r) => !r.version).map(({ id, parentVid, label, at, by }) => ({ id, parentVid, label, at: at.toISOString(), by }));
  const first = rows.reduce<Date | null>((a, r) => (!a || r.at < a ? r.at : a), null);
  return { subs, first: first?.toISOString() ?? null };
}
