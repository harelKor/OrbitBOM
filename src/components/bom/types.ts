import type { PartRow } from "@/lib/parts/changes";

// What the BOM views get for each part.
export type CardPart = PartRow & {
  id: string;
  systemId: string;
  systemName: string;
  isManual: boolean;
  onshapeName: string | null;
  lastModifiedAt: Date;
  lastModifiedByName: string | null;
  files: { id: string; type: string; filename: string }[];
  thumbUrl: string | null;
  modelKey: string | null; // the part's key in the robot's 3D model
  geometry?: { onshapeMaterial?: string; sheetMetal?: { flatPartId: string }; wallMm?: number } | null;
  groups: { id: string; name: string; color: string | null }[];
  memberIds?: string[]; // set on a merged row
  fabFinishedAt?: Date | null; // first made (To Fab's Finished section)
};

// The real part behind a row: a merged row's files and exports belong to its first member.
// The real parts behind a row, space-separated, for [data-part~=id] (Recent actions links).
export const partIds = (p: Pick<CardPart, "id" | "memberIds">) => (p.memberIds ?? [p.id]).join(" ");

export const ownerPartId = (p: Pick<CardPart, "id" | "memberIds">) => p.memberIds?.[0] ?? p.id;

// The app has no part number field: a part goes by its name (the Onshape name unless renamed).
export function partTitle(p: Pick<CardPart, "displayName" | "onshapeName">): string {
  return p.displayName ?? p.onshapeName ?? "Unnamed part";
}
