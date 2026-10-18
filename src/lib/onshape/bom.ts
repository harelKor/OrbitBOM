// Turns Onshape's assembly BOM response (GET /assemblies/.../bom) into BOM rows the sync can
// merge. Material and the processes come from the team's custom part properties (ref §6).

import { findMachineByName } from "@/config/machines";
import { ONSHAPE_PROPERTIES } from "@/config/onshapeProperties";

export type OnshapeBomHeader = { id: string; name: string; propertyName?: string };
export type OnshapeBomRow = {
  headerIdToValue: Record<string, unknown>;
  itemSource?: {
    documentId?: string;
    elementId?: string;
    partId?: string;
    wvmType?: string;
    wvmId?: string;
  };
};
export type OnshapeBom = { headers?: OnshapeBomHeader[]; rows?: OnshapeBomRow[] };

export type BomRow = {
  sourceDid: string;
  sourceWid: string | null;
  sourceWvm: string | null;
  sourceEid: string;
  onshapePartId: string;
  onshapeName: string;
  partNumber: string | null;
  description: string | null;
  material: string | null;
  onshapeMaterial: string | null;
  quantity: number;
  preProcess: string | null;
  process1: string | null;
  process2: string | null;
};

export type ParsedBom = { rows: BomRow[]; unknownMachines: string[]; skipped: number };

// BOM cell values are strings, numbers, or objects such as a material
// ({ displayName, ... }) or an enum ({ value, displayName }).
export function cellText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return cellText(o.displayName ?? o.name ?? o.value ?? null);
  }
  return null;
}

function findHeader(headers: OnshapeBomHeader[], id: string, ...names: string[]) {
  if (id) {
    const byId = headers.find((h) => h.id === id);
    if (byId) return byId.id;
  }
  const wanted = names.map((n) => n.toLowerCase());
  return headers.find((h) => wanted.includes(h.name.toLowerCase()))?.id;
}

export function parseBom(bom: OnshapeBom): ParsedBom {
  const headers = bom.headers ?? [];
  const col = {
    name: findHeader(headers, "", "Name"),
    partNumber: findHeader(headers, "", "Part number"),
    description: findHeader(headers, "", "Description"),
    quantity: findHeader(headers, "", "Quantity", "Qty"),
    onshapeMaterial: findHeader(headers, "", "Material"),
    material: ONSHAPE_PROPERTIES.material.id
      ? findHeader(headers, ONSHAPE_PROPERTIES.material.id)
      : undefined,
    preProcess: findHeader(headers, ONSHAPE_PROPERTIES.preProcess.id, ONSHAPE_PROPERTIES.preProcess.name),
    process1: findHeader(headers, ONSHAPE_PROPERTIES.process1.id, ONSHAPE_PROPERTIES.process1.name),
    process2: findHeader(headers, ONSHAPE_PROPERTIES.process2.id, ONSHAPE_PROPERTIES.process2.name),
  };

  const unknownMachines = new Set<string>();
  const machine = (value: unknown) => {
    const name = cellText(value);
    if (!name) return null;
    const m = findMachineByName(name);
    if (!m) unknownMachines.add(name);
    return m?.id ?? null;
  };
  const get = (row: OnshapeBomRow, id: string | undefined) => (id ? row.headerIdToValue[id] : undefined);

  // The flattened BOM can list the same part more than once; add up the quantities.
  const byKey = new Map<string, BomRow>();
  let skipped = 0;
  for (const row of bom.rows ?? []) {
    const src = row.itemSource ?? {};
    const name = cellText(get(row, col.name));
    if (!src.documentId || !src.elementId || !src.partId || !name) {
      skipped++; // subassembly rows and anything that isn't a part
      continue;
    }
    const onshapeMaterial = cellText(get(row, col.onshapeMaterial));
    const parsed: BomRow = {
      sourceDid: src.documentId,
      sourceWid: src.wvmId ?? null,
      sourceWvm: src.wvmType ?? null,
      sourceEid: src.elementId,
      onshapePartId: src.partId,
      onshapeName: name,
      partNumber: cellText(get(row, col.partNumber)),
      description: cellText(get(row, col.description)),
      material: col.material ? cellText(get(row, col.material)) : onshapeMaterial,
      onshapeMaterial,
      quantity: Math.max(0, Math.round(Number(cellText(get(row, col.quantity)) ?? 1)) || 0),
      preProcess: machine(get(row, col.preProcess)),
      process1: machine(get(row, col.process1)),
      process2: machine(get(row, col.process2)),
    };
    const key = partKey(parsed);
    const seen = byKey.get(key);
    if (seen) seen.quantity += parsed.quantity;
    else byKey.set(key, parsed);
  }
  return { rows: [...byKey.values()], unknownMachines: [...unknownMachines], skipped };
}

// A part's identity (ref §6): Part Studio + partId + Onshape name. The workspace/version id is
// left out so identity survives an assembly version bump.
export function partKey(p: {
  sourceDid: string | null;
  sourceEid: string | null;
  onshapePartId: string | null;
  onshapeName: string | null;
}): string {
  return [p.sourceDid, p.sourceEid, p.onshapePartId, p.onshapeName].join("|");
}
