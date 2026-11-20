import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { VersionChange, VersionRef } from "@/db/schema";
import { parseBom, partKey, type BomRow, type OnshapeBom } from "@/lib/onshape/bom";
import { onshapeClient, OnshapeError, type OnshapeClient } from "@/lib/onshape/client";
import { studioPath } from "@/lib/onshape/parts";
import { apiPath, parseOnshapeUrl } from "@/lib/onshape/url";
import { applyBomRows, sigKey } from "@/lib/sync/applyBom";
import { commitDraft, VersionError } from "./commit";
import { planMerge } from "@/lib/sync/merge";
import { readDocVersions } from "./docVersions";
import { onshapeName } from "./label";
import { heldParts } from "./history";
import { collidingNumbers, numberOf } from "@/lib/parts/dataChecks";
import { shapeFingerprints } from "./shape";
import { sameState, snapshotOfRow } from "./snapshot";

const { onshapeCache, parts, systems, systemVersions } = schema;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// What a draft keeps to be applied as it is on commit.
// `held`: parts a Revert holds behind the latest version (history.ts), left alone unless listed.
// `collisions`: part numbers the BOM has on two different shapes (Name collision, warn only).
export type DraftRows = { bom: BomRow[]; sigs: Record<string, string>; partSigs: Record<string, string>; unknownMachines: string[]; held?: string[]; collisions?: string[] };

export type Draft = {
  id: string;
  name: string | null;
  onshape: string | null; // the Onshape version it comes from, "V70"
  detectedAt: Date;
  changes: VersionChange[];
  collisions: string[]; // part numbers on two different shapes: a warning, never a block
};

// A change whose shape had nothing stored to compare with, or whose new shape Onshape didn't send
// (see checkSystem).
export const SHAPE_UNKNOWN = "Shape not compared before";
// A part with the same shape in a newer Onshape reference (a newer version, a new partId).
export const SAME_SHAPE = "Same shape, newer Onshape version";

export type CheckResult = {
  draft: Draft | null; // null: the system is up to date with Onshape
  unchanged: boolean; // nothing moved in Onshape since the last check
  applied?: boolean; // same parts in a newer reference were taken without a commit
  calls: number;
};

export const draftOf = (row: typeof systemVersions.$inferSelect): Draft => ({
  id: row.id,
  name: row.name,
  onshape: onshapeName(row.onshapeRef),
  detectedAt: row.detectedAt,
  changes: row.changes,
  collisions: (row.rows as DraftRows | null)?.collisions ?? [...new Set(row.changes.filter((c) => c.collision).map((c) => numberOf({ partNumber: c.partNumber, onshapeName: c.name })!))],
});

export async function loadDraft(systemId: string): Promise<Draft | null> {
  const row = await loadDraftRow(systemId);
  return row ? draftOf(row) : null;
}

// Change detection (plan/system-versioning.md §4). Reads the Manufacture assembly's BOM and
// compares it to the system's parts, which hold the committed state. Nothing reaches the BOM
// here: what changed is kept in the system's one draft until a member commits it. When the only
// changes move parts' Onshape references (the same shape in a newer version, or under a new
// partId), fab would make exactly the same parts: they're committed at once, as a version of
// their own, so the version tree shows where the BOM is (Harel, 2026-11-18: they used to be taken
// with no version, and the tree kept "BOM is on this" on the old one).
// With `force` false (the background refresh and the Onshape panel) it stops after one call
// when the document's microversion is the one last seen.
export async function checkSystem(systemId: string, memberId: string, { force = true } = {}): Promise<CheckResult> {
  const [system] = await db.select().from(systems).where(eq(systems.id, systemId)).limit(1);
  if (!system) throw new OnshapeError("System not found.");
  const linked = system.assemblyUrl ? parseOnshapeUrl(system.assemblyUrl) : null;
  if (!linked?.eid) throw new OnshapeError("This system has no Onshape assembly URL.");
  const client = onshapeClient(memberId, linked.baseUrl);
  const current = await loadDraftRow(systemId);

  // 1. Did anything move? A system that follows versions reads its document's newest Onshape
  // version (1 call) and is read at that version; otherwise a workspace's microversion is
  // checked (a version or microversion link never changes).
  const followed = system.followVersions ? await newestVersion(client, linked.did) : null;
  if (system.followVersions && !followed) throw new OnshapeError("Make a version of the assembly's document in Onshape first: this system follows its versions.");
  const ref = followed ? { ...linked, wvm: "v" as const, wvmid: followed.id } : linked;
  let microversion: string | null = null;
  if (ref.wvm === "w") {
    microversion = (await client.json<{ microversion: string }>(`documents/d/${ref.did}/w/${ref.wvmid}/currentmicroversion`)).microversion;
  }
  const seen = followed
    ? system.followedVersionId === followed.id || current?.onshapeRef?.vid === followed.id
    : ref.wvm !== "w" || system.docMicroversions[ref.did] === microversion || current?.onshapeRef?.mv === microversion;
  if (!force && seen) {
    await db.update(systems).set({ lastCheckedAt: new Date() }).where(eq(systems.id, systemId));
    return { draft: current ? draftOf(current) : null, unchanged: true, calls: client.calls };
  }

  // 2. The BOM.
  const bom = await client.json<OnshapeBom>(`assemblies/${apiPath(ref)}/bom?indented=false&multiLevel=false&generateIfAbsent=true`);
  const parsed = parseBom(bom);
  const existing = await db.select().from(parts).where(eq(parts.systemId, systemId));
  const byId = new Map(existing.map((p) => [p.id, p]));

  // 3. Shapes. Parts in a Part Studio reference that may hold new geometry (a workspace, or a
  // version or microversion the committed parts don't use yet) get a fingerprint; so do the
  // committed parts in it that have none stored yet, at their old, frozen reference. One call
  // per Part Studio. Same shape = same part, whatever its Onshape partId or version.
  const committedPaths = new Set(existing.filter((p) => !p.removedFromCadAt).map((p) => studioPath(p)));
  const fresh = new Map<string, string[]>();
  for (const r of parsed.rows) {
    const path = studioPath(r);
    if (path && (r.sourceWvm === "w" || !committedPaths.has(path))) fresh.set(path, [...(fresh.get(path) ?? []), r.onshapePartId]);
  }
  const names = new Set(parsed.rows.filter((r) => fresh.has(studioPath(r) ?? "")).map((r) => r.onshapeName));
  const old = new Map<string, string[]>();
  for (const p of existing) {
    const path = studioPath(p);
    if (p.isManual || p.shapeSig || !path || p.sourceWvm === "w" || fresh.has(path) || !names.has(p.onshapeName ?? "")) continue;
    old.set(path, [...(old.get(path) ?? []), p.onshapePartId!]);
  }
  // A first sync stores its parts' shapes too, so the next Update BOM can see a changed shape
  // (it used to skip them, and the next check then took workspace parts' new shapes without
  // asking: Harel, 2026-11-13). Kept per Part Studio revision, so it isn't paid twice.
  const [sigs, oldSigs] = await Promise.all([shapeFingerprints(client, fresh), shapeFingerprints(client, old)]);
  const partSigs: Record<string, string> = {};
  for (const p of existing) {
    const sig = !p.shapeSig && oldSigs[sigKey(p)];
    if (sig) partSigs[p.id] = sig;
  }
  const committedSig = (p: (typeof existing)[number]) => p.shapeSig ?? partSigs[p.id] ?? null;

  // 4. Merged against the committed parts, same-shaped parts paired first: the list a member reviews.
  const plan = planMerge(
    existing.map((p) => ({ ...p, shapeSig: committedSig(p) })),
    parsed.rows,
    (r) => sigs[sigKey(r)],
  );
  // A part a Revert holds back isn't new when Onshape still has its newest committed state.
  const held = await heldParts(db, systemId);
  const rowByKey = new Map(parsed.rows.map((r) => [partKey(r), r]));
  const isHeldAsIs = (partId: string, row: BomRow | undefined) => {
    const newest = held.get(partId);
    if (!newest) return false;
    if (!row) return newest.change === "removed";
    return newest.change !== "removed" && sameState(newest.snapshot, snapshotOfRow(row, sigs[sigKey(row)] ?? null, {}));
  };

  const changes: VersionChange[] = [];
  for (const r of plan.insert) {
    changes.push({ key: partKey(r), partId: null, change: "added", name: r.onshapeName, partNumber: r.partNumber, fields: {}, geometry: false });
  }
  let moved = false; // only shapes to store: taken as they are
  const relinked: VersionChange[] = []; // same shapes in a newer reference
  for (const u of plan.update) {
    const part = byId.get(u.id)!;
    if (isHeldAsIs(u.id, rowByKey.get(partKey(u.identity)))) continue;
    const fields: VersionChange["fields"] = {};
    for (const [field, to] of Object.entries(u.changes)) fields[field] = { from: part[field as keyof typeof part], to };
    if (part.onshapeName !== u.identity.onshapeName) fields.onshapeName = { from: part.onshapeName, to: u.identity.onshapeName };
    const material = part.geometry?.onshapeMaterial ?? null;
    if (material !== u.onshapeMaterial) fields.onshapeMaterial = { from: material, to: u.onshapeMaterial };
    const sig = sigs[sigKey(u.identity)];
    const before = committedSig(part);
    // No committed shape (synced before shapes were stored, in a workspace that has moved on): the
    // shape can't be compared, so the member looks at it in the Commit window instead of it being
    // taken silently.
    // Or the part moved to a reference whose shape was asked for but didn't come (its Part Studio's
    // mass properties failed): it may have changed, so it's never taken unseen (Harel, 2026-11-18).
    const asked = fresh.has(studioPath(u.identity) ?? "") && studioPath(part) !== studioPath(u.identity);
    const unknown = !!(sig && !before) || (!sig && asked);
    const geometry = !!(sig && before && sig !== before) || unknown;
    const base = { key: partKey(u.identity), partId: u.id, name: u.identity.onshapeName, partNumber: part.partNumber, fields, geometry };
    if (u.restore) changes.push({ ...base, change: "added", note: "Back in CAD" });
    else if (geometry || Object.keys(fields).length) changes.push({ ...base, change: "modified", ...(unknown ? { note: SHAPE_UNKNOWN } : {}) });
    else if (u.relinked || studioPath(part) !== studioPath(u.identity)) relinked.push({ ...base, change: "modified", note: SAME_SHAPE });
    else if (sig && sig !== part.shapeSig) moved = true;
  }
  for (const id of plan.remove) {
    const part = byId.get(id)!;
    if (isHeldAsIs(id, undefined)) continue;
    changes.push({ key: partKey(part), partId: id, change: "removed", name: part.onshapeName ?? "Part", partNumber: part.partNumber, fields: {}, geometry: false });
  }

  // Name collision (audit 2026-11-20, Harel: warn only, it never blocks a commit or release): one
  // part number on two different shapes. A row's shape is its new fingerprint, else the committed
  // part's it was paired with.
  const rowSig = new Map<string, string | null>(parsed.rows.map((r) => [partKey(r), sigs[sigKey(r)] ?? null]));
  for (const u of plan.update) if (!rowSig.get(partKey(u.identity))) rowSig.set(partKey(u.identity), committedSig(byId.get(u.id)!));
  const colliding = collidingNumbers(parsed.rows, numberOf, (r) => rowSig.get(partKey(r)));
  const collide = (c: VersionChange) => (c.change !== "removed" && colliding.has(numberOf({ partNumber: c.partNumber, onshapeName: c.name }) ?? "") ? { ...c, collision: true } : c);
  changes.splice(0, changes.length, ...changes.map(collide));
  relinked.splice(0, relinked.length, ...relinked.map(collide));

  // Only same shapes in newer references: committed below as a version of their own. With other
  // changes they're taken when the draft is committed, as before.
  const auto = !changes.length && relinked.length > 0;
  if (auto) changes.push(...relinked);
  const order = { modified: 0, added: 1, removed: 2 };
  changes.sort((x, y) => order[x.change] - order[y.change] || x.name.localeCompare(y.name, undefined, { numeric: true }));

  const now = new Date();
  const listed = new Set(changes.map((c) => c.partId));
  const keep = [...held.keys()].filter((id) => !listed.has(id));
  const rows: DraftRows = { bom: parsed.rows, sigs, partSigs, unknownMachines: parsed.unknownMachines, held: keep, collisions: [...colliding] };
  const seenMv = {
    ...(microversion ? { docMicroversions: { ...system.docMicroversions, [ref.did]: microversion } } : {}),
    ...(followed ? { followedVersionId: followed.id } : {}),
  };
  const account = force ? { refreshMemberId: memberId } : {};

  // The Onshape calls above take seconds. Before saving, the system is locked and its draft read
  // again: a member may have committed it (the draft row became the version), reverted the
  // system, or another check saved first. Then this check's list is out of date, so it saves
  // nothing and returns what is there now (it used to delete or overwrite the new version).
  const stillCurrent = async (tx: Tx) => {
    const [locked] = await tx.select({ currentVersionId: systems.currentVersionId }).from(systems).where(eq(systems.id, systemId)).for("update");
    const [draft] = await tx
      .select()
      .from(systemVersions)
      .where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "draft")))
      .for("update");
    const same =
      !!locked &&
      locked.currentVersionId === system.currentVersionId &&
      (draft?.id ?? null) === (current?.id ?? null) &&
      (!draft || !current || +draft.detectedAt === +current.detectedAt);
    return { same, draft: draft ?? null };
  };
  const superseded = (draft: typeof systemVersions.$inferSelect | null): CheckResult => ({ draft: draft ? draftOf(draft) : null, unchanged: false, calls: client.calls });

  if (!changes.length) {
    // Up to date. Same parts in a newer reference (or a first microversion) are taken as they are.
    return db.transaction(async (tx) => {
      const { same, draft } = await stillCurrent(tx);
      if (!same) return superseded(draft);
      if (moved) await applyBomRows(tx, systemId, parsed.rows, { memberId, batchId: randomUUID(), sigs, partSigs, skip: new Set(keep) });
      if (current) await tx.delete(systemVersions).where(and(eq(systemVersions.id, current.id), eq(systemVersions.state, "draft")));
      await tx.update(systems).set({ lastCheckedAt: now, ...seenMv, ...account }).where(eq(systems.id, systemId));
      return { draft: null, unchanged: false, applied: moved, calls: client.calls };
    });
  }

  // 5. Keep it in the draft. A draft whose list didn't change keeps its time, so a member
  // halfway through reviewing it can still commit.
  const onshapeRef: VersionRef = { mv: microversion, did: ref.did, ...(followed ? { vid: followed.id } : {}), ...(await versionNames(client, existing, parsed.rows)) };
  const name = current?.name ?? null;
  const same = current && stable(current.changes) === stable(changes);
  const values = { name, onshapeRef, changes, rows, ...(same ? {} : { detectedAt: now, detectedBy: memberId }) };
  let wrote: string | null = null; // the draft this check saved (not one another check or commit left)
  const saved = await db.transaction(async (tx) => {
    const fresh = await stillCurrent(tx);
    if (!fresh.same) return superseded(fresh.draft);
    const [row] = current
      ? await tx
          .update(systemVersions)
          .set(values)
          .where(and(eq(systemVersions.id, current.id), eq(systemVersions.state, "draft")))
          .returning()
      : await tx.insert(systemVersions).values({ systemId, state: "draft", detectedBy: memberId, ...values }).returning();
    await tx
      .update(systems)
      .set({ lastCheckedAt: now, ...account, ...(followed ? { followedVersionId: followed.id } : {}) })
      .where(eq(systems.id, systemId));
    wrote = row.id;
    return { draft: draftOf(row), unchanged: false, calls: client.calls } as CheckResult;
  });
  if (!auto || !saved.draft || saved.draft.id !== wrote) return saved;
  try {
    await commitDraft(systemId, memberId, { draftId: saved.draft.id, seen: saved.draft.detectedAt.toISOString(), name: SAME_SHAPE });
  } catch (err) {
    // Committed or replaced meanwhile: the draft (or what replaced it) waits for a member.
    if (err instanceof VersionError) return saved;
    throw err;
  }
  return { draft: null, unchanged: false, applied: true, calls: client.calls };
}

// JSON with sorted keys: Postgres stores jsonb keys in its own order.
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
      : JSON.stringify(v ?? null);

async function loadDraftRow(systemId: string) {
  const [row] = await db
    .select()
    .from(systemVersions)
    .where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "draft")));
  return row ?? null;
}

// The Onshape version names ("V70") of the documents the assembly inserts by version: the ones
// the BOM uses now (`sources`) and the ones the committed parts use (`from`), which name a
// version on the site. A version's name never changes, so each is read once (1 call) and kept.
async function versionNames(
  client: OnshapeClient,
  existing: { sourceDid: string | null; sourceWvm: string | null; sourceWid: string | null; removedFromCadAt: Date | null; isManual: boolean }[],
  rows: BomRow[],
): Promise<Pick<VersionRef, "sources" | "from">> {
  const used = (list: { sourceDid: string | null; sourceWvm: string | null; sourceWid: string | null }[]) => {
    // Every document's part count, workspace ones too: when most parts come from a workspace,
    // no Onshape version names the site's version.
    const count = new Map<string, number>();
    const out = new Map<string, { versionId: string; parts: number; main: boolean }>();
    for (const p of list) if (p.sourceDid) count.set(p.sourceDid, (count.get(p.sourceDid) ?? 0) + 1);
    const main = [...count].reduce<[string, number] | null>((best, d) => (!best || d[1] > best[1] ? d : best), null)?.[0];
    for (const p of list) if (p.sourceDid && p.sourceWvm === "v" && p.sourceWid) out.set(p.sourceDid, { versionId: p.sourceWid, parts: count.get(p.sourceDid)!, main: p.sourceDid === main });
    return out;
  };
  const named = async (docs: Map<string, { versionId: string; parts: number; main: boolean }>) => {
    const out: NonNullable<VersionRef["sources"]> = {};
    for (const [did, { versionId, parts, main }] of docs) {
      const name = await versionName(client, did, versionId);
      if (name) out[did] = { versionId, name, parts, main };
    }
    return out;
  };
  return {
    sources: await named(used(rows)),
    from: await named(used(existing.filter((p) => !p.isManual && !p.removedFromCadAt))),
  };
}

// A document's newest Onshape version (1 call). Its name is kept like versionName's, so naming
// the draft costs nothing more.
export async function newestVersion(client: OnshapeClient, did: string): Promise<{ id: string; name: string } | null> {
  // The whole list is kept for the CAD Review version tree, at no extra call.
  const list = await readDocVersions(client, did);
  const newest = list.reduce<(typeof list)[number] | null>((best, v) => (!best || (v.createdAt ?? "") > (best.createdAt ?? "") ? v : best), null);
  if (!newest) return null;
  if (newest.name) await db.insert(onshapeCache).values({ key: `version-name:${newest.id}`, payload: { name: newest.name } }).onConflictDoNothing();
  return { id: newest.id, name: newest.name ?? "" };
}

async function versionName(client: OnshapeClient, did: string, versionId: string): Promise<string | null> {
  const key = `version-name:${versionId}`;
  const [cached] = await db.select({ payload: onshapeCache.payload }).from(onshapeCache).where(eq(onshapeCache.key, key));
  if (cached) return (cached.payload as { name: string }).name;
  try {
    const v = await client.json<{ name?: string }>(`documents/d/${did}/versions/${versionId}`);
    if (!v.name) return null;
    await db.insert(onshapeCache).values({ key, payload: { name: v.name } }).onConflictDoNothing();
    return v.name;
  } catch (err) {
    if (!(err instanceof OnshapeError)) throw err;
    return null;
  }
}
