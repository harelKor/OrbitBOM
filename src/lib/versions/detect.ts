import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { VersionChange, VersionRef } from "@/db/schema";
import { parseBom, partKey, type BomRow, type OnshapeBom } from "@/lib/onshape/bom";
import { onshapeClient, OnshapeError, type OnshapeClient } from "@/lib/onshape/client";
import { studioPath, type PartMetadata } from "@/lib/onshape/parts";
import { apiPath, parseOnshapeUrl } from "@/lib/onshape/url";
import { applyBomRows, mvKey } from "@/lib/sync/applyBom";
import { planMerge } from "@/lib/sync/merge";

const { parts, systems, systemVersions } = schema;

// What a draft keeps to be applied as it is on commit.
export type DraftRows = { bom: BomRow[]; mvs: Record<string, string>; unknownMachines: string[] };

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
// that only move a part's Onshape reference (the same part in a newer subassembly version)
// are applied at once, since fab would make exactly the same part.
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

  // 2. The BOM, merged against the committed parts.
  const bom = await client.json<OnshapeBom>(`assemblies/${apiPath(ref)}/bom?indented=false&multiLevel=false&generateIfAbsent=true`);
  const parsed = parseBom(bom);
  const existing = await db.select().from(parts).where(eq(parts.systemId, systemId));
  const plan = planMerge(existing, parsed.rows);
  const byId = new Map(existing.map((p) => [p.id, p]));

  // 3. Which shapes changed: each part's Onshape microversion, one parts list per Part Studio
  // that may have changed (a workspace one, or one whose version moved, or a new part's).
  const studios = new Set<string>();
  for (const u of plan.update) {
    const part = byId.get(u.id)!;
    const path = studioPath(u.identity);
    if (path && (u.identity.sourceWvm === "w" || studioPath(part) !== path || !part.onshapeMv)) studios.add(path);
  }
  for (const r of plan.insert) {
    const path = studioPath(r);
    if (path) studios.add(path);
  }
  const mvs = await partMicroversions(client, [...studios]);

  // 4. The list a member reviews.
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
    const mv = mvs[mvKey(u.identity)];
    const geometry = !!(mv && part.onshapeMv && mv !== part.onshapeMv);
    const base = { key: partKey(u.identity), partId: u.id, name: u.identity.onshapeName, partNumber: part.partNumber, fields, geometry };
    if (u.restore) changes.push({ ...base, change: "added", note: "Back in CAD" });
    else if (geometry || Object.keys(fields).length) changes.push({ ...base, change: "modified", ...(u.relinked ? { note: "Re-linked by name" } : {}) });
    else if (studioPath(part) !== studioPath(u.identity) || (mv && mv !== part.onshapeMv)) moved = true;
  }
  for (const id of plan.remove) {
    const part = byId.get(id)!;
    changes.push({ key: partKey(part), partId: id, change: "removed", name: part.onshapeName ?? "Part", partNumber: part.partNumber, fields: {}, geometry: false });
  }

  const now = new Date();
  const rows: DraftRows = { bom: parsed.rows, mvs, unknownMachines: parsed.unknownMachines };
  const seenMv = microversion ? { docMicroversions: { ...system.docMicroversions, [ref.did]: microversion } } : {};
  const account = force ? { refreshMemberId: memberId } : {};

  if (!changes.length) {
    // Up to date. Same parts in a newer reference (or a first microversion) are taken as they are.
    await db.transaction(async (tx) => {
      if (moved) await applyBomRows(tx, systemId, parsed.rows, { memberId, batchId: randomUUID(), mvs });
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

// Each part's Onshape microversion, by mvKey, a few Part Studios at a time. A Part Studio that
// fails is left out: its parts count as unchanged in shape.
async function partMicroversions(client: OnshapeClient, paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const queue = [...paths];
  const worker = async () => {
    for (let path = queue.shift(); path; path = queue.shift()) {
      const [, did, , , , eid] = path.split("/");
      try {
        const metas = await client.json<PartMetadata[]>(`parts/${path}?withThumbnails=false`);
        for (const m of Array.isArray(metas) ? metas : []) {
          if (!m.isFlattenedBody && m.microversionId) out[mvKey({ sourceDid: did, sourceEid: eid, onshapePartId: m.partId })] = m.microversionId;
        }
      } catch (err) {
        if (!(err instanceof OnshapeError)) throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return out;
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
