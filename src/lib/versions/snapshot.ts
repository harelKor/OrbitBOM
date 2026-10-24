import type { PartSnapshot } from "@/db/schema";
import type { BomRow } from "@/lib/onshape/bom";
import { frozenStudio } from "./studio";

type PartLike = Omit<PartSnapshot, "onshapeMaterial" | "sig"> & { geometry: { onshapeMaterial?: string } | null; shapeSig: string | null };

export const snapshotOfPart = (p: PartLike, docMvs: Record<string, string>): PartSnapshot => ({
  sourceDid: p.sourceDid,
  sourceWid: p.sourceWid,
  sourceWvm: p.sourceWvm,
  sourceEid: p.sourceEid,
  onshapePartId: p.onshapePartId,
  onshapeName: p.onshapeName,
  partNumber: p.partNumber,
  description: p.description,
  material: p.material,
  onshapeMaterial: p.geometry?.onshapeMaterial ?? null,
  quantity: p.quantity,
  preProcess: p.preProcess,
  process1: p.process1,
  process2: p.process2,
  sig: p.shapeSig,
  studio: frozenStudio(p, docMvs),
});

export const snapshotOfRow = (r: BomRow, sig: string | null, docMvs: Record<string, string>): PartSnapshot => ({
  sourceDid: r.sourceDid,
  sourceWid: r.sourceWid,
  sourceWvm: r.sourceWvm,
  sourceEid: r.sourceEid,
  onshapePartId: r.onshapePartId,
  onshapeName: r.onshapeName,
  partNumber: r.partNumber,
  description: r.description,
  material: r.material,
  onshapeMaterial: r.onshapeMaterial,
  quantity: r.quantity,
  preProcess: r.preProcess,
  process1: r.process1,
  process2: r.process2,
  sig,
  studio: frozenStudio(r, docMvs),
});

// Whether two states are the same part for fab: same shape (when both are known) and the same
// Onshape fields.
export function sameState(a: PartSnapshot, b: PartSnapshot): boolean {
  if (a.sig && b.sig && a.sig !== b.sig) return false;
  const fields = ["onshapeName", "description", "material", "onshapeMaterial", "quantity", "preProcess", "process1", "process2"] as const;
  return fields.every((f) => (a[f] ?? null) === (b[f] ?? null));
}
