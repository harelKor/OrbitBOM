import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OnshapeLayoutRef } from "@/db/schema";
import { batchFlatParts } from "@/lib/fab/batchLayout";
import { placementMatrix, type FlatPart, type Placement } from "@/lib/fab/layout";
import { flatSource } from "@/lib/model/part";
import { BudgetError, OnshapeError, QuotaError, TeamBudgetError, type OnshapeClient } from "@/lib/onshape/client";
import { exportPart, importFile } from "@/lib/onshape/export";
import { PartFileError, partFileTarget } from "@/lib/onshape/partFile";
import { getObject, objectExists, putObject, storageConfigured } from "@/lib/storage/r2";
import { parseOnshapeUrl } from "@/lib/onshape/url";

// "Onshape Layout": a batch's nested parts as a "Batch - <name>" assembly in Onshape, every copy
// lying flat on Z = 0 with its pockets up at its place on the sheet. The flat frames come from the
// cached meshes (src/lib/fab/batchLayout.ts, no Onshape calls). Onshape calls, every one counted
// against the app's yearly allowance:
//   new tab:   [document lookup] + create assembly + one insert-and-place call   = 2-3
//   same tab:  read the assembly + delete its old instances + one insert-and-place = 3
// Failed calls don't count, so a fallback after a refused call costs nothing extra.
// Sheet metal goes in as its flat pattern. Onshape won't place a flat body in an assembly (spike
// 2026-11-04), so its flat STEP is imported into the layout's document as a Part Studio, where it
// keeps the flat body's coordinates, and that part is placed with the same transform. Once per
// part revision (export, upload, polls, its part: about 5-8 calls, the STEP kept in R2), then one
// call per push to check the imported tab is still there.

export type LayoutPush = { url: string; calls: number; copies: number; skipped: string[]; live: string[]; fellBack?: boolean };

type Ref = { did: string; wvm: "w" | "v" | "m"; wvmid: string; eid: string; partId: string };
type Copy = { name: string; ref: Ref; transform: number[]; partId: string; sheet: boolean };

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
    copies.push({ name, ref, transform: toOnshapeTransform(placementMatrix(flat, pl)), partId: pl.partId, sheet: !!flat.sheetMetal });
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

  // Sheet metal copies: the imported flat part in this document, imported once per revision.
  const imports = { ...(group.layoutData?.flatImports ?? {}) };
  const deadline = Date.now() + 40_000;
  for (const partId of new Set(copies.filter((c) => c.sheet).map((c) => c.partId))) {
    const row = rowOf.get(partId)!;
    const src = flatSource(row.part, true);
    const name = row.part.displayName ?? row.part.onshapeName ?? "Part";
    let placedAs: Ref | null = null;
    try {
      if (!src) throw new OnshapeError("no flat pattern");
      const source = `${src.rev ?? ""}|${src.studio}|${src.flatPartId}`;
      const key = `${did}|${partId}`;
      const hit = imports[key];
      if (hit && hit.did === did && hit.source === source) {
        // Still there? (A member may have deleted the tab in Onshape.)
        const there = await client.json<{ partId: string }[]>(`parts/${doc}/e/${hit.eid}`).catch((err) => {
          if (err instanceof OnshapeError && (err.status === 404 || err.status === 400)) return [];
          throw err;
        });
        if (there.some((p) => p.partId === hit.partId)) placedAs = { did, wvm: "w", wvmid: wid, eid: hit.eid, partId: hit.partId };
      }
      if (!placedAs) {
        const imported = await importFlat(client, doc, { part: row.part, assemblyUrl: row.assemblyUrl, robotId: group.robotId }, deadline);
        imports[key] = { did, eid: imported.eid, partId: imported.partId, source };
        placedAs = { did, wvm: "w", wvmid: wid, ...imported };
      }
    } catch (err) {
      // Out of calls stops the push; a part Onshape couldn't import is left out and named.
      if (err instanceof BudgetError || err instanceof TeamBudgetError || err instanceof QuotaError) throw err;
      if (!(err instanceof OnshapeError || err instanceof PartFileError)) throw err;
      if (!skipped.includes(name)) skipped.push(name);
    }
    for (const c of copies) if (c.partId === partId) c.ref = placedAs ?? c.ref;
    if (!placedAs) copies.splice(0, copies.length, ...copies.filter((c) => c.partId !== partId));
  }
  // Kept at once, so a push that fails later (or falls back to another document) doesn't import
  // the same flat patterns again next time.
  if (JSON.stringify(imports) !== JSON.stringify(group.layoutData?.flatImports ?? {})) {
    await db
      .update(schema.partGroups)
      .set({ layoutData: sql`coalesce(${schema.partGroups.layoutData}, '{}'::jsonb) || ${JSON.stringify({ flatImports: imports })}::jsonb` })
      .where(eq(schema.partGroups.id, groupId));
  }
  if (!copies.length) throw new OnshapeError("None of this batch's parts could be placed in Onshape.");

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
    .set({ layoutData: sql`coalesce(${schema.partGroups.layoutData}, '{}'::jsonb) || ${JSON.stringify({ onshape: ref, flatImports: imports })}::jsonb` })
    .where(eq(schema.partGroups.id, groupId));
  return { url, calls: client.calls, copies: placed.length, skipped, live };
}

// A sheet metal part's flat STEP (the same file as its Flat STEP download, kept in R2 per
// revision) imported into the document as its own Part Studio tab: that tab and its one part.
async function importFlat(client: OnshapeClient, doc: string, row: { part: typeof schema.parts.$inferSelect; assemblyUrl: string | null; robotId: string }, deadline: number) {
  const target = partFileTarget(row, "STEP_FLAT", true);
  const stored = storageConfigured() && target.key && (await objectExists(target.key)) ? await getObject(target.key) : null;
  let file: ArrayBuffer;
  if (stored) file = await stored.arrayBuffer();
  else {
    file = await exportPart(client, target.studio, target.partId, "STEP_FLAT", deadline);
    if (storageConfigured() && target.key) await putObject(target.key, file, target.type);
  }
  const eid = await importFile(client, doc, file, target.filename, deadline);
  const parts = await client.json<{ partId: string }[]>(`parts/${doc}/e/${eid}`);
  if (!parts[0]?.partId) throw new OnshapeError("The imported flat pattern has no part.");
  return { eid, partId: parts[0].partId };
}
