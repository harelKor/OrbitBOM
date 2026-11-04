import "server-only";
import { type schema } from "@/db";
import { studioPath } from "@/lib/onshape/parts";
import { flatMesh, partMesh } from "@/lib/model/part";
import { getObject, objectExists, putObject, storageConfigured } from "@/lib/storage/r2";
import { writeDxf } from "./dxf";
import { flattenMesh } from "./flatten";

// A plate's flat 1:1 DXF (the part laid on its back face, pockets up, long side level). Made from
// the part's cached 3D mesh, so usually no Onshape calls; an Onshape sheet metal part is drawn from
// its flat pattern's mesh instead (Onshape won't translate a flat body to DXF, spike 2026-11-04).
// Kept in R2 per part revision: downloading it again, or in a batch zip, reads the stored file.

export const PLATE_DXF_VERSION = 1; // bump when the DXF output changes, so every file is made again

type Row = { part: typeof schema.parts.$inferSelect; robotId: string; assemblyUrl: string | null };
type Member = { id: string; onshapeConnected: boolean };

export class PlateDxfError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

// What the file is made from: the state released to fab (?fab=1) when the part is locked there.
function source(row: Row, fab: boolean) {
  const lock = fab && row.part.releasedSnapshot?.studio && row.part.releasedSnapshot.onshapePartId ? row.part.releasedSnapshot : null;
  return {
    lock,
    rev: lock ? lock.thumbnailRev : row.part.thumbnailRev,
    flatPartId: lock ? lock.flatPartId : row.part.geometry?.sheetMetal?.flatPartId,
  };
}

export function plateDxfName(part: Row["part"], qty?: number) {
  const name = (part.displayName ?? part.onshapeName ?? "part").replace(/[^\w.\- ]+/g, "_");
  return `${part.partNumber ? `${part.partNumber} ` : ""}${name}${qty && qty > 1 ? `_qty${qty}` : ""}.dxf`;
}

// The face a member chose to lay the plate on in a batch's Auto Layout (its outward normal), else
// the pockets-up rule. Stored apart per face, so each is made once.
type Down = [number, number, number] | null | undefined;
const faceTag = (down: Down) => (down ? `.f${down.map((n) => Math.round(n * 1000)).join("_")}` : "");

export function plateDxfKey(row: Row, fab: boolean, down?: Down): string | null {
  const { rev, flatPartId } = source(row, fab);
  return rev ? `exports/${row.part.id}/${rev}.${flatPartId ? `flat${PLATE_DXF_VERSION}${faceTag(down)}` : `plate${PLATE_DXF_VERSION}${faceTag(down)}`}.dxf` : null;
}

// The DXF text, from R2 when it's stored, else made (and stored when the part has a revision).
// `down`: the face chosen in Auto Layout (for sheet metal, which side of its flat pattern).
// `_deadline` is kept for callers: making a DXF is now one mesh read at most, well inside it.
export async function plateDxf(row: Row, member: Member, fab: boolean, _deadline: number, down?: Down): Promise<string> {
  if (!studioPath(row.part)) throw new PlateDxfError("This part isn't from Onshape.");
  const key = storageConfigured() ? plateDxfKey(row, fab, down) : null;
  if (key && (await objectExists(key))) {
    const res = await getObject(key);
    if (res) return res.text();
  }
  const text = await makeDxf(row, member, fab, down);
  if (key) await putObject(key, new TextEncoder().encode(text), "image/vnd.dxf");
  return text;
}

async function makeDxf(row: Row, member: Member, fab: boolean, down: Down): Promise<string> {
  const { lock, flatPartId } = source(row, fab);
  if (flatPartId) {
    // Onshape sheet metal: its flat pattern (bends unfolded, Onshape's own bend allowance).
    const got = await flatMesh(row, member, { fab });
    if (!got) throw new PlateDxfError("This part's flat pattern isn't available.");
    const flat = flattenMesh(got.mesh.positions, got.mesh.indices, 1000, down);
    if (!flat) throw new PlateDxfError("This part's flat pattern couldn't be read.");
    return writeDxf(flat.loops.map((l) => l.pts));
  }
  // The released state's mesh is read from its frozen Part Studio only when the part changed since.
  const frozen = lock && lock.thumbnailRev !== row.part.thumbnailRev ? { studio: lock.studio!, onshapePartId: lock.onshapePartId! } : null;
  const mesh = await partMesh(row, member, frozen);
  if (!mesh) throw new PlateDxfError("This part's 3D shape isn't available.");
  const flat = flattenMesh(mesh.positions, mesh.indices, 1000, down);
  // A plate is thin next to its outline (as the drawings' reader decides).
  if (!flat || flat.thickness > 0.25 * Math.min(flat.size[0], flat.size[1])) {
    throw new PlateDxfError("This part isn't a flat plate, so it has no flat DXF. Download its STEP instead.");
  }
  return writeDxf(flat.loops.map((l) => l.pts));
}
