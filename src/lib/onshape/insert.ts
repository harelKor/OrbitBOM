import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ModelKind } from "@/db/schema";
import { flattenAssembly, partKey, type AssemblyDefinition } from "@/lib/model/assembly";
import type { OnshapeClient } from "@/lib/onshape/client";
import type { OnshapeRef } from "@/lib/onshape/url";
import { keptDocVersions } from "@/lib/versions/docVersions";
import { derivedFeature, groupParts, type InsertPart } from "./insertPlan";

// Insert from the Onshape panel (Harel, 2026-11-21, like FRCDesignLib): parts go into the open
// Part Studio as one Derived feature per source Part Studio and version (Harel's choice), or into
// the open assembly as one instance each, always at an Onshape version, never a workspace, so no
// system references another's live design (no cyclic references). Every call goes through the
// member's own onshapeClient and counts against the budget.

export type InsertTarget = OnshapeRef & { eid: string; kind: "partstudio" | "assembly" };
export type InsertMeta = { label: string; featureName: string; systemId?: string | null; itemId?: string | null; model?: ModelKind | null; memberId: string };
export type InsertResult = { inserted: number; skipped: string[] };

// The parts behind model keys (did:eid:partId) of a system shown at one Onshape version of its
// own document: parts of that document are at that version; parts from linked documents at the
// version the assembly holds them at, read from the assembly at that version (1 call, only when
// some part is from another document). Configured parts are skipped: not supported yet.
export async function resolveSystemParts(client: OnshapeClient, source: { did: string; eid: string; kind: "assembly" | "partstudio" }, versionId: string, keys: string[]): Promise<{ parts: InsertPart[]; skipped: string[] }> {
  const parts: InsertPart[] = [];
  const skipped: string[] = [];
  const foreign: string[] = [];
  for (const k of new Set(keys)) {
    const [did, eid, partId] = k.split(":");
    if (!did || !eid || !partId) continue;
    if (did === source.did) parts.push({ did, eid, partId, versionId });
    else if (source.kind === "assembly") foreign.push(k);
  }
  if (foreign.length) {
    const def = await client.json<AssemblyDefinition>(`assemblies/d/${source.did}/v/${versionId}/e/${source.eid}?includeMateFeatures=false&includeMateConnectors=false&includeNonSolids=false`);
    const at = new Map<string, { version?: string; configuration?: string }>();
    for (const p of flattenAssembly(def)) at.set(partKey(p.studio.did, p.studio.eid, p.partId), p.studio);
    for (const k of foreign) {
      const s = at.get(k);
      const [did, eid, partId] = k.split(":");
      if (s?.configuration) skipped.push(`${partId}: configured parts aren't supported yet`);
      else if (!s?.version) skipped.push(`${partId}: not found at a version in this version of the assembly`);
      else parts.push({ did, eid, partId, versionId: s.version });
    }
  }
  return { parts, skipped };
}

// The element's microversion at a version: the Derived feature's reference names it.
async function elementMicroversion(client: OnshapeClient, did: string, vid: string, eid: string): Promise<string> {
  const els = await client.json<{ id: string; microversionId?: string }[]>(`documents/d/${did}/v/${vid}/elements?elementId=${eid}`);
  const mv = els.find((e) => e.id === eid)?.microversionId;
  if (!mv) throw new Error("Onshape didn't give that Part Studio's state at this version.");
  return mv;
}

type AssemblyInstances = { rootAssembly?: { instances?: { id: string }[] } };
const instanceIds = async (client: OnshapeClient, t: InsertTarget) =>
  new Set(((await client.json<AssemblyInstances>(`assemblies/d/${t.did}/w/${t.wvmid}/e/${t.eid}?includeMateFeatures=false&includeMateConnectors=false&includeNonSolids=false`)).rootAssembly?.instances ?? []).map((i) => i.id));

export async function insertParts(client: OnshapeClient, target: InsertTarget, parts: InsertPart[], meta: InsertMeta): Promise<InsertResult> {
  if (target.wvm !== "w") throw new Error("Open the document's workspace (not a version) to insert into it.");
  const skipped: string[] = [];
  // Onshape references other documents only at versions; parts of this same document are
  // already here.
  const usable = parts.filter((p) => {
    if (p.did !== target.did) return true;
    skipped.push(`${p.partId}: it's in this same document`);
    return false;
  });
  const groups = groupParts(usable);
  const base = { targetDid: target.did, targetWid: target.wvmid, targetEid: target.eid, targetKind: target.kind, label: meta.label, systemId: meta.systemId ?? null, itemId: meta.itemId ?? null, model: meta.model ?? null, memberId: meta.memberId };
  let inserted = 0;
  if (target.kind === "partstudio") {
    for (const g of groups) {
      const mv = await elementMicroversion(client, g.did, g.versionId, g.eid);
      const made = await client.json<{ feature?: { featureId?: string } }>(`partstudios/d/${target.did}/w/${target.wvmid}/e/${target.eid}/features`, { method: "POST", body: JSON.stringify(derivedFeature(meta.featureName, { ...g, microversion: mv })) });
      const fid = made.feature?.featureId;
      if (!fid) throw new Error("Onshape didn't add the Derived feature.");
      await db.insert(schema.onshapeInserts).values({ ...base, createdIds: [fid], sourceDid: g.did, sourceEid: g.eid, partIds: g.partIds, versionId: g.versionId });
      inserted += g.partIds.length;
    }
    return { inserted, skipped };
  }
  // An assembly: one instance per part. Onshape's answer doesn't name the new instance, so the
  // instance ids are read before and after (2 calls for the whole insert).
  const before = await instanceIds(client, target);
  for (const g of groups)
    for (const partId of g.partIds) {
      await client.raw(`assemblies/d/${target.did}/w/${target.wvmid}/e/${target.eid}/instances`, {
        method: "POST",
        body: JSON.stringify({ documentId: g.did, elementId: g.eid, versionId: g.versionId, partId, isAssembly: false, isWholePartStudio: false, includePartTypes: ["PARTS"] }),
      });
      inserted++;
    }
  const added = [...(await instanceIds(client, target))].filter((id) => !before.has(id));
  // Onshape adds new instances at the end, in the order they were inserted.
  let at = 0;
  for (const g of groups) {
    await db.insert(schema.onshapeInserts).values({ ...base, createdIds: added.slice(at, at + g.partIds.length), sourceDid: g.did, sourceEid: g.eid, partIds: g.partIds, versionId: g.versionId });
    at += g.partIds.length;
  }
  return { inserted, skipped };
}

// A version's name and day for the message: the CAD update's, else the kept version list's.
export async function versionName(did: string, versionId: string): Promise<{ name: string; cadUpdate: Date | null } | null> {
  const [cu] = await db
    .select({ label: schema.cadUpdates.label, at: schema.cadUpdates.createdAt })
    .from(schema.cadUpdates)
    .where(and(eq(schema.cadUpdates.did, did), eq(schema.cadUpdates.onshapeVersionId, versionId)))
    .orderBy(desc(schema.cadUpdates.createdAt))
    .limit(1);
  if (cu) return { name: cu.label, cadUpdate: cu.at };
  const kept = (await keptDocVersions(did))?.versions.find((v) => v.id === versionId);
  return kept ? { name: kept.name, cadUpdate: null } : null;
}

