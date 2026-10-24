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
import { planMerge } from "@/lib/sync/merge";
import { shapeFingerprints } from "./shape";

const { parts, systems, systemVersions } = schema;

// What a draft keeps to be applied as it is on commit.
export type DraftRows = { bom: BomRow[]; sigs: Record<string, string>; partSigs: Record<string, string>; unknownMachines: string[] };

export type Draft = {
  id: string;
  name: string | null;
  detectedAt: Date;
  changes: VersionChange[];
};

export type CheckResult = {
  draft: Draft | null; // null: the system is up to date with Onshape
  unchanged: boolean; // nothing moved in Onshape since the last check
  calls: number;
};

export const draftOf = (row: typeof systemVersions.$inferSelect): Draft => ({
  id: row.id,
  name: row.name,
  detectedAt: row.detectedAt,
  changes: row.changes,
});

export async function loadDraft(systemId: string): Promise<Draft | null> {
  const row = await loadDraftRow(systemId);
  return row ? draftOf(row) : null;
}

// Change detection (plan/system-versioning.md §4). Reads the Manufacture assembly's BOM and
// compares it to the system's parts, which hold the committed state. Nothing reaches the BOM
// here: what changed is kept in the system's one draft until a member commits it. Changes
// that only move a part's Onshape reference (the same shape in a newer subassembly version,
// or under a new partId) are applied at once, since fab would make exactly the same part.
// With `force` false (the background refresh and the Onshape panel) it stops after one call
// when the document's microversion is the one last seen.
export async function checkSystem(systemId: string, memberId: string, { force = true } = {}): Promise<CheckResult> {
  const [system] = await db.select().from(systems).where(eq(systems.id, systemId)).limit(1);
  if (!system) throw new OnshapeError("System not found.");
  const ref = system.assemblyUrl ? parseOnshapeUrl(system.assemblyUrl) : null;
  if (!ref?.eid) throw new OnshapeError("This system has no Onshape assembly URL.");
  const client = onshapeClient(memberId, ref.baseUrl);
  const current = await loadDraftRow(systemId);

  // 1. Did anything move? A version or microversion link never changes, so only a workspace is checked.
  let microversion: string | null = null;
  if (ref.wvm === "w") {
    microversion = (await client.json<{ microversion: string }>(`documents/d/${ref.did}/w/${ref.wvmid}/currentmicroversion`)).microversion;
  }
  const seen = ref.wvm !== "w" || system.docMicroversions[ref.did] === microversion || current?.onshapeRef?.mv === microversion;
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
  const changes: VersionChange[] = [];
  for (const r of plan.insert) {
    changes.push({ key: partKey(r), partId: null, change: "added", name: r.onshapeName, partNumber: r.partNumber, fields: {}, geometry: false });
  }
  let moved = false;
  for (const u of plan.update) {
    const part = byId.get(u.id)!;
    const fields: VersionChange["fields"] = {};
    for (const [field, to] of Object.entries(u.changes)) fields[field] = { from: part[field as keyof typeof part], to };
    if (part.onshapeName !== u.identity.onshapeName) fields.onshapeName = { from: part.onshapeName, to: u.identity.onshapeName };
    const material = part.geometry?.onshapeMaterial ?? null;
    if (material !== u.onshapeMaterial) fields.onshapeMaterial = { from: material, to: u.onshapeMaterial };
    const sig = sigs[sigKey(u.identity)];
    const before = committedSig(part);
    const geometry = !!(sig && before && sig !== before);
    const base = { key: partKey(u.identity), partId: u.id, name: u.identity.onshapeName, partNumber: part.partNumber, fields, geometry };
    if (u.restore) changes.push({ ...base, change: "added", note: "Back in CAD" });
    else if (geometry || Object.keys(fields).length) changes.push({ ...base, change: "modified" });
    else if (u.relinked || studioPath(part) !== studioPath(u.identity) || (sig && sig !== part.shapeSig)) moved = true;
  }
  for (const id of plan.remove) {
    const part = byId.get(id)!;
    changes.push({ key: partKey(part), partId: id, change: "removed", name: part.onshapeName ?? "Part", partNumber: part.partNumber, fields: {}, geometry: false });
  }

  const order = { modified: 0, added: 1, removed: 2 };
  changes.sort((x, y) => order[x.change] - order[y.change] || x.name.localeCompare(y.name, undefined, { numeric: true }));

  const now = new Date();
  const rows: DraftRows = { bom: parsed.rows, sigs, partSigs, unknownMachines: parsed.unknownMachines };
  const seenMv = microversion ? { docMicroversions: { ...system.docMicroversions, [ref.did]: microversion } } : {};
  const account = force ? { refreshMemberId: memberId } : {};

  if (!changes.length) {
    // Up to date. Same parts in a newer reference (or a first microversion) are taken as they are.
    await db.transaction(async (tx) => {
      if (moved) await applyBomRows(tx, systemId, parsed.rows, { memberId, batchId: randomUUID(), sigs, partSigs });
      if (current) await tx.delete(systemVersions).where(eq(systemVersions.id, current.id));
      await tx.update(systems).set({ lastCheckedAt: now, ...seenMv, ...account }).where(eq(systems.id, systemId));
    });
    return { draft: null, unchanged: false, calls: client.calls };
  }

  // 5. Keep it in the draft. A draft whose list didn't change keeps its time, so a member
  // halfway through reviewing it can still commit.
  const onshapeRef: VersionRef = { mv: microversion, did: ref.did, sources: await versionNames(client, existing, parsed.rows) };
  const name = Object.values(onshapeRef.sources ?? {}).map((s) => s.name).join(", ") || null;
  const same = current && stable(current.changes) === stable(changes);
  const values = { name, onshapeRef, changes, rows, ...(same ? {} : { detectedAt: now, detectedBy: memberId }) };
  const [row] = current
    ? await db.update(systemVersions).set(values).where(eq(systemVersions.id, current.id)).returning()
    : await db.insert(systemVersions).values({ systemId, state: "draft", detectedBy: memberId, ...values }).returning();
  await db.update(systems).set({ lastCheckedAt: now, ...account }).where(eq(systems.id, systemId));
  return { draft: draftOf(row), unchanged: false, calls: client.calls };
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

// The Onshape version names of subassemblies whose inserted version changed ("V13 shorter arm"),
// for the version's default name. One call per changed document.
async function versionNames(
  client: OnshapeClient,
  existing: { sourceDid: string | null; sourceWvm: string | null; sourceWid: string | null }[],
  rows: BomRow[],
): Promise<VersionRef["sources"]> {
  const before = new Map<string, Set<string>>();
  for (const p of existing) {
    if (p.sourceDid && p.sourceWvm === "v" && p.sourceWid) before.set(p.sourceDid, (before.get(p.sourceDid) ?? new Set()).add(p.sourceWid));
  }
  const moved = new Map<string, string>();
  for (const r of rows) {
    if (r.sourceWvm === "v" && r.sourceWid && before.has(r.sourceDid) && !before.get(r.sourceDid)!.has(r.sourceWid)) moved.set(r.sourceDid, r.sourceWid);
  }
  const out: NonNullable<VersionRef["sources"]> = {};
  for (const [did, versionId] of moved) {
    try {
      const v = await client.json<{ name?: string }>(`documents/d/${did}/versions/${versionId}`);
      if (v.name) out[did] = { versionId, name: v.name };
    } catch (err) {
      if (!(err instanceof OnshapeError)) throw err;
    }
  }
  return out;
}
