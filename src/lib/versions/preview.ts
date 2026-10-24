import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { TESS_QUERY, TESS_VERSION } from "@/lib/model/build";
import { encodeMeshes, meshesFromTessellation, type Tessellation } from "@/lib/model/mesh";
import { NeedsOnshapeError } from "@/lib/model/part";
import { partKey } from "@/lib/onshape/bom";
import { onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { imageUrl, objectExists, putObject, StorageNotConfiguredError, storageConfigured } from "@/lib/storage/r2";
import type { DraftRows } from "./detect";
import { frozenStudio } from "./studio";

const { parts, partVersions, systems, systemVersions } = schema;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// After from a draft (draftId + key) or a committed state (rowId: its version's After, the part's
// state before it as Before); Before alone (partId) is the part's committed state.
export type PreviewRequest = { side: "before" | "after"; draftId?: string; key?: string; partId?: string; rowId?: string };

// One side of a change's Before → After 3D preview (plan/system-versioning.md §7). After: the
// part as the system's draft found it in Onshape. Before: the part's committed state. Each is
// read from a frozen Part Studio reference (a version or a document microversion), so it is
// exported once (1 Onshape call) and kept in R2.
export async function previewModel(systemId: string, member: { id: string; onshapeConnected: boolean }, req: PreviewRequest) {
  if (!storageConfigured()) throw new StorageNotConfiguredError();
  const [system] = await db.select().from(systems).where(eq(systems.id, systemId));
  if (!system) return null;

  let studio: string | null = null;
  let partId: string | null = null;
  if (req.rowId) {
    const found = await committedState(systemId, req.rowId, req.side);
    if (!found) return null;
    studio = found.studio ?? frozenStudio(found, {});
    partId = found.onshapePartId;
  } else if (req.side === "after") {
    if (!req.draftId || !req.key) return null;
    const [draft] = await db
      .select()
      .from(systemVersions)
      .where(and(eq(systemVersions.id, req.draftId), eq(systemVersions.systemId, systemId), eq(systemVersions.state, "draft")));
    const row = (draft?.rows as DraftRows | null)?.bom.find((r) => partKey(r) === req.key);
    if (!draft || !row) return null;
    studio = frozenStudio(row, draft.onshapeRef?.mv ? { [draft.onshapeRef.did]: draft.onshapeRef.mv } : {});
    partId = row.onshapePartId;
  } else {
    if (!req.partId) return null;
    const [row] = await db
      .select({ part: parts, snapshot: partVersions.snapshot })
      .from(parts)
      .leftJoin(partVersions, eq(partVersions.id, parts.versionRowId))
      .where(and(eq(parts.id, req.partId), eq(parts.systemId, systemId)));
    if (!row) return null;
    const committed = row.snapshot ?? row.part;
    studio = row.snapshot?.studio ?? frozenStudio(committed, system.docMicroversions);
    partId = committed.onshapePartId;
  }
  if (!studio || !partId) return null;

  const [, did, , , , eid] = studio.split("/");
  const key = `models/previews/${createHash("sha1").update(`${TESS_VERSION}|${studio}|${partId}`).digest("hex").slice(0, 24)}.bin.gz`;
  const frozen = !studio.includes("/w/");
  if (!frozen || !(await objectExists(key))) {
    if (!member.onshapeConnected) throw new NeedsOnshapeError("Connect your Onshape account first (Profile → Connect Onshape).");
    const ref = system.assemblyUrl ? parseOnshapeUrl(system.assemblyUrl) : null;
    const client = onshapeClient(member.id, ref?.baseUrl ?? "https://cad.onshape.com");
    const tess = await client.json<Tessellation>(`partstudios/${studio}/tessellatedfaces?${TESS_QUERY}&partId=${encodeURIComponent(partId)}`);
    const meshes = meshesFromTessellation(tess).filter((m) => m.partId === partId);
    if (!meshes.length) throw new OnshapeError("Onshape sent no shape for this part.");
    await putObject(key, gzipSync(encodeMeshes(meshes)), "application/gzip");
  }
  return { studios: [await imageUrl(key)], placements: [{ s: 0, k: `${did}:${eid}:${partId}`, t: IDENTITY }] };
}

// A committed part state (After), or the part's state in the version before it (Before).
async function committedState(systemId: string, rowId: string, side: "before" | "after") {
  const rows = await db
    .select({ id: partVersions.id, partId: partVersions.partId, seq: systemVersions.seq, snapshot: partVersions.snapshot, change: partVersions.change })
    .from(partVersions)
    .innerJoin(systemVersions, eq(systemVersions.id, partVersions.versionId))
    .where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "committed")));
  const row = rows.find((r) => r.id === rowId);
  if (!row) return null;
  if (side === "after") return row.snapshot;
  const before = rows
    .filter((r) => r.partId === row.partId && (r.seq ?? 0) < (row.seq ?? 0) && r.change !== "removed")
    .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))[0];
  return before?.snapshot ?? null;
}
