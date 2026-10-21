// Where an Onshape part lives, from the identity a BOM sync stored on it.

export type PartSource = {
  sourceDid: string | null;
  sourceWvm: string | null;
  sourceWid: string | null;
  sourceEid: string | null;
  onshapePartId: string | null;
};

// "d/<did>/w/<wid>/e/<eid>" for the part's Part Studio, or null for manual parts.
export function studioPath(p: PartSource): string | null {
  const wvm = p.sourceWvm?.[0]?.toLowerCase();
  if (!p.sourceDid || !p.sourceWid || !p.sourceEid || !p.onshapePartId || !wvm || !"wvm".includes(wvm)) return null;
  return `d/${p.sourceDid}/${wvm}/${p.sourceWid}/e/${p.sourceEid}`;
}

export type PartMetadata = {
  partId: string;
  name?: string;
  bodyType?: string;
  microversionId?: string;
  isFlattenedBody?: boolean; // a sheet metal part's flat pattern (listed with includeFlatParts)
  unflattenedPartId?: string; // the folded part a flat pattern belongs to
  thumbnailInfo?: { sizes?: { size: string; href: string; mediaType?: string }[] };
};

// The thumbnail to keep: 300x300 if offered, else the largest.
export function thumbnailHref(meta: PartMetadata): string | null {
  const sizes = meta.thumbnailInfo?.sizes ?? [];
  const area = (s: string) => s.split("x").reduce((a, b) => a * Number(b), 1) || 0;
  const pick = sizes.find((s) => s.size === "300x300") ?? [...sizes].sort((a, b) => area(b.size) - area(a.size))[0];
  return pick?.href ?? null;
}
