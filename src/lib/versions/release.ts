import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ReleasedSnapshot } from "@/db/schema";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { deleteObject } from "@/lib/storage/r2";
import { versionLabel } from "./label";
import { frozenStudio } from "./studio";

const { parts, partReleases, partVersions, systems, systemVersions } = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Part = typeof parts.$inferSelect;

// The statuses that send a made part to fab (plan/fab-version-lock.md §2): moving into one locks
// the part's state for To Fab.
export const RELEASE_STATUSES = ["Released", "Reproduction", "Secondary Production"];

export const isReleaseMove = (before: Part, after: Part) =>
  after.classification !== "cots" && !!after.designState && RELEASE_STATUSES.includes(after.designState) && after.designState !== before.designState;

// Locks the part's current state (`after`, already saved) as the one To Fab shows, and records
// the release on its version history.
export async function lockRelease(tx: Tx, after: Part, ctx: { memberId: string | null; batchId?: string; status?: string }) {
  const status = ctx.status ?? after.designState ?? "Released";
  const [row] = after.versionRowId
    ? await tx
        .select({ versionId: partVersions.versionId, snapshot: partVersions.snapshot, seq: systemVersions.seq, onshapeRef: systemVersions.onshapeRef, name: systemVersions.name })
        .from(partVersions)
        .innerJoin(systemVersions, eq(systemVersions.id, partVersions.versionId))
        .where(eq(partVersions.id, after.versionRowId))
    : [];
  const [system] = after.systemId ? await tx.select({ docMicroversions: systems.docMicroversions }).from(systems).where(eq(systems.id, after.systemId)) : [];
  const snapshot: ReleasedSnapshot = {
    name: after.displayName ?? after.onshapeName,
    quantity: after.quantity,
    material: after.material,
    thumbnailRev: after.thumbnailRev,
    shapeSig: after.shapeSig,
    studio: row?.snapshot.studio ?? frozenStudio(after, system?.docMicroversions ?? {}),
    onshapePartId: after.onshapePartId,
    flatPartId: after.geometry?.sheetMetal?.flatPartId ?? null,
    versionLabel: row ? versionLabel(row) : null,
    versionName: row?.name ?? null,
    status,
    at: new Date().toISOString(),
  };
  await tx
    .update(parts)
    .set({ releasedVersionId: row?.versionId ?? null, releasedRowId: after.versionRowId, releasedSnapshot: snapshot })
    .where(eq(parts.id, after.id));
  // The picture of the state it was locked at before, kept only for To Fab, is no longer needed.
  const was = after.releasedSnapshot?.thumbnailRev;
  if (was && was !== after.thumbnailRev) await deleteObject(thumbKey(after.id, was)).catch(() => {});
  await tx.insert(partReleases).values({ partId: after.id, versionId: row?.versionId ?? null, rowId: after.versionRowId, status, memberId: ctx.memberId, batchId: ctx.batchId });
}

// To Fab's red Changed tag: the BOM's latest committed state differs from what was released, in
// shape or quantity.
export function fabChanged(p: Pick<Part, "releasedSnapshot" | "shapeSig" | "quantity">): boolean {
  const s = p.releasedSnapshot;
  if (!s) return false;
  return s.quantity !== p.quantity || (!!s.shapeSig && !!p.shapeSig && s.shapeSig !== p.shapeSig);
}

// "Update fab version": the part's fab lock moves to its latest committed state, status unchanged.
export async function relockPart(partId: string, memberId: string) {
  return db.transaction(async (tx) => {
    const [part] = await tx.select().from(parts).where(eq(parts.id, partId)).for("update");
    if (!part) return false;
    await lockRelease(tx, part, { memberId, status: part.designState ?? "Released" });
    return true;
  });
}
