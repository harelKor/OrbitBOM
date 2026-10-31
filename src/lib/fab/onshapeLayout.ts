import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OnshapeLayoutRef } from "@/db/schema";
import { batchFlatParts } from "@/lib/fab/batchLayout";
import { placementMatrix, type FlatPart, type Placement } from "@/lib/fab/layout";
import { OnshapeError, type OnshapeClient } from "@/lib/onshape/client";
import { parseOnshapeUrl } from "@/lib/onshape/url";

// "Onshape Layout": a batch's nested parts as a "Batch - <name>" assembly in Onshape, every copy
// lying flat on Z = 0 with its pockets up at its place on the sheet. The flat frames come from the
// cached meshes (src/lib/fab/batchLayout.ts, no Onshape calls). Onshape calls, every one counted
// against the app's yearly allowance:
//   new tab:   [document lookup] + create assembly + one insert-and-place call   = 2-3
//   same tab:  read the assembly + delete its old instances + one insert-and-place = 3
// Failed calls don't count, so a fallback after a refused call costs nothing extra.

export type LayoutPush = { url: string; calls: number; copies: number; skipped: string[]; live: string[]; fellBack?: boolean };

type Ref = { did: string; wvm: "w" | "v" | "m"; wvmid: string; eid: string; partId: string };
type Copy = { name: string; ref: Ref; transform: number[] };

const STUDIO = /^d\/([0-9a-f]{24})\/([wvm])\/([0-9a-f]{24})\/e\/([0-9a-f]{24})$/i;

// The Part Studio a copy is inserted from: the version the part was released at (To Fab), else the
// live Part Studio.
function partRef(p: typeof schema.parts.$inferSelect): Ref | null {
  const lock = p.releasedSnapshot?.studio && p.releasedSnapshot.onshapePartId ? p.releasedSnapshot : null;
  const studio = lock?.studio ?? (p.sourceDid && p.sourceWvm && p.sourceWid && p.sourceEid ? `d/${p.sourceDid}/${p.sourceWvm[0].toLowerCase()}/${p.sourceWid}/e/${p.sourceEid}` : null);
  const partId = lock?.onshapePartId ?? p.onshapePartId;
  const m = studio ? STUDIO.exec(studio) : null;
  if (!m || !partId) return null;
  return { did: m[1].toLowerCase(), wvm: m[2].toLowerCase() as Ref["wvm"], wvmid: m[3].toLowerCase(), eid: m[4].toLowerCase(), partId };
}

// Onshape takes a 4x4 row-major transform in metres; the layout's is in millimetres.
export function toOnshapeTransform(mm: number[]): number[] {
  return mm.map((v, i) => (i === 3 || i === 7 || i === 11 ? v / 1000 : v));
}

// The instance Onshape inserts for a reference. A Part Studio in the assembly's own document is
// referenced live unless `pinned`; another document needs a version (or microversion).
function instanceParams(ref: Ref, did: string, pinned: boolean) {
  const same = ref.did === did;
  return {
    documentId: ref.did,
    elementId: ref.eid,
    partId: ref.partId,
    isAssembly: false,
    isWholePartStudio: false,
    ...(ref.wvm === "v" && (!same || pinned) && { versionId: ref.wvmid }),
    ...(ref.wvm === "m" && (!same || pinned) && { microversionId: ref.wvmid }),
  };
}

type Definition = { rootAssembly?: { instances?: { id: string }[] } };

export async function pushOnshapeLayout(
  client: OnshapeClient,
  groupId: string,
  placements: Placement[],
  useLayoutsDocument = true,
): Promise<LayoutPush> {
  const [group] = await db.select().from(schema.partGroups).where(eq(schema.partGroups.id, groupId));
  if (!group) throw new OnshapeError("This batch no longer exists.");
  const [robot] = await db
    .select({ url: schema.robots.layoutsDocumentUrl, did: schema.robots.layoutsDocumentId, wid: schema.robots.layoutsWorkspaceId })
    .from(schema.robots)
    .where(eq(schema.robots.id, group.robotId));
  const rows = await db
    .select({ part: schema.parts, assemblyUrl: schema.systems.assemblyUrl, docMvs: schema.systems.docMicroversions })
    .from(schema.groupMembers)
    .innerJoin(schema.parts, eq(schema.parts.id, schema.groupMembers.partId))
    .leftJoin(schema.systems, eq(schema.systems.id, schema.parts.systemId))
    .where(eq(schema.groupMembers.groupId, groupId));
  const { parts: flats } = await batchFlatParts(groupId);
  const flatOf = new Map<string, FlatPart>(flats.map((f) => [f.partId, f]));
  const rowOf = new Map(rows.map((r) => [r.part.id, r]));

  const skipped: string[] = [];
  const copies: Copy[] = [];
  for (const pl of placements) {
    const row = rowOf.get(pl.partId);
    const flat = flatOf.get(pl.partId);
    const ref = row && partRef(row.part);
    const name = row ? (row.part.displayName ?? row.part.onshapeName ?? "Part") : "Part";
    if (!row || !flat || !ref) {
      if (!skipped.includes(name)) skipped.push(name);
      continue;
    }
    copies.push({ name, ref, transform: toOnshapeTransform(placementMatrix(flat, pl)) });
  }
  if (!copies.length) throw new OnshapeError("None of this batch's parts can be placed in Onshape (no 3D model yet, or not from Onshape).");

  // The robot's Batch Layouts document when it has one (Settings or the Onshape panel); else the
  // document most copies come from, normally the system's own.
  const layouts = useLayoutsDocument && robot?.did && robot.wid && robot.url ? parseOnshapeUrl(robot.url) : null;
  const counts = new Map<string, number>();
  for (const c of copies) counts.set(c.ref.did, (counts.get(c.ref.did) ?? 0) + 1);
  const did = layouts ? robot.did! : [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const systemRefs = rows.map((r) => (r.assemblyUrl ? parseOnshapeUrl(r.assemblyUrl) : null));
  const system = systemRefs.find((r) => r?.did === did) ?? systemRefs.find(Boolean);
  const baseUrl = layouts?.baseUrl ?? system?.baseUrl ?? "https://cad.onshape.com";

  // Another document's live Part Studio can't be inserted, so pin it to the document state the last
  // Update BOM saw (no Onshape call).
  const mvs: Record<string, string> = Object.assign({}, ...rows.map((r) => r.docMvs ?? {}));
  for (const c of copies) {
    if (c.ref.did !== did && c.ref.wvm === "w" && mvs[c.ref.did]) c.ref = { ...c.ref, wvm: "m", wvmid: mvs[c.ref.did] };
  }

  const prev = group.layoutData?.onshape;
  const saved = prev?.did === did && prev.baseUrl === baseUrl ? prev : null;
  // The document's workspace, from what we already know before asking Onshape.
  const wid =
    (layouts ? robot.wid : null) ??
    saved?.wid ??
    (system?.did === did && system.wvm === "w" ? system.wvmid : null) ??
    rows.find((r) => r.part.sourceDid === did && r.part.sourceWvm?.[0]?.toLowerCase() === "w")?.part.sourceWid ??
    (await client.json<{ defaultWorkspace?: { id: string } }>(`documents/${did}`)).defaultWorkspace?.id;
  if (!wid) throw new OnshapeError("Couldn't find the Onshape document's workspace.");
  const doc = `d/${did}/w/${wid}`;
  const tabName = `Batch - ${group.name}`;

  // Reuse this batch's tab, emptied; a new one when there is none (or it was deleted in Onshape).
  let eid: string | null = saved?.eid ?? null;
  if (eid) {
    const def = await client.json<Definition>(`assemblies/${doc}/e/${eid}?includeMateFeatures=false&includeMateConnectors=false&includeNonSolids=false`).catch((err) => {
      if (err instanceof OnshapeError && err.status === 404) return null;
      throw err;
    });
    if (!def) eid = null;
    else {
      const old = (def.rootAssembly?.instances ?? []).map((i) => i.id);
      if (old.length) {
        try {
          await client.json(`assemblies/${doc}/e/${eid}/modify`, { method: "POST", body: JSON.stringify({ deleteInstances: old }) });
        } catch (err) {
          if (!(err instanceof OnshapeError) || !err.status || err.status >= 500 || err.status === 402) throw err;
          // Onshape refused the bulk delete: replace the tab instead (same number of calls).
          await client.raw(`elements/${doc}/e/${eid}`, { method: "DELETE" }).catch(() => null);
          eid = null;
        }
      }
    }
  }
  if (!eid) {
    const created = await client.json<{ id: string }>(`assemblies/${doc}`, { method: "POST", body: JSON.stringify({ name: tabName }) });
    eid = created.id;
  }

  // Insert every copy already placed: one transform group per copy, all in one call.
  const insert = (list: Copy[], pinned: boolean) =>
    client.json(`assemblies/${doc}/e/${eid}/transformedinstances`, {
      method: "POST",
      body: JSON.stringify({ transformGroups: list.map((c) => ({ instances: [instanceParams(c.ref, did, pinned)], transform: c.transform })) }),
    });
  const live: string[] = [];
  let placed = copies;
  try {
    await insert(copies, true);
  } catch (err) {
    if (!(err instanceof OnshapeError) || err.status !== 400) throw err;
    // Onshape won't pin a Part Studio of the assembly's own document to a version: use those live.
    // Another document's live Part Studio can't be inserted at all.
    placed = copies.filter((c) => c.ref.did === did || c.ref.wvm !== "w");
    for (const c of copies) if (c.ref.did === did && c.ref.wvm !== "w" && !live.includes(c.name)) live.push(c.name);
    for (const c of copies) if (!placed.includes(c) && !skipped.includes(c.name)) skipped.push(c.name);
    try {
      await insert(placed, false);
    } catch (again) {
      if (!layouts || !(again instanceof OnshapeError) || again.status !== 400) throw again;
      // Onshape refused parts from the robots' documents in the Layouts document: remove the empty
      // tab and make the layout in the system's own document instead.
      await client.raw(`elements/${doc}/e/${eid}`, { method: "DELETE" }).catch(() => null);
      const out = await pushOnshapeLayout(client, groupId, placements, false);
      return { ...out, fellBack: true };
    }
  }

  const rev = createHash("sha1").update(JSON.stringify([eid, placed.map((c) => [c.ref, c.transform])])).digest("hex").slice(0, 16);
  const url = `${baseUrl}/documents/${did}/w/${wid}/e/${eid}`;
  const ref: OnshapeLayoutRef = { baseUrl, did, wid, eid, url, rev, createdAt: new Date().toISOString() };
  await db
    .update(schema.partGroups)
    .set({ layoutData: sql`coalesce(${schema.partGroups.layoutData}, '{}'::jsonb) || ${JSON.stringify({ onshape: ref })}::jsonb` })
    .where(eq(schema.partGroups.id, groupId));
  return { url, calls: client.calls, copies: placed.length, skipped, live };
}
