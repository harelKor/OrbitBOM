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
  groups: { id: string; name: string; color: string | null }[];
  memberIds?: string[]; // set on a merged row
};

// The real part behind a row: a merged row's files and exports belong to its first member.
export const ownerPartId = (p: Pick<CardPart, "id" | "memberIds">) => p.memberIds?.[0] ?? p.id;

export function partTitle(p: Pick<CardPart, "partNumber" | "displayName" | "onshapeName">): string {
  const name = p.displayName ?? p.onshapeName ?? "Unnamed part";
  return p.partNumber ? `${p.partNumber} ${name}` : name;
}
