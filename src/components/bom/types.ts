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
};

export function partTitle(p: Pick<CardPart, "partNumber" | "displayName" | "onshapeName">): string {
  const name = p.displayName ?? p.onshapeName ?? "Unnamed part";
  return p.partNumber ? `${p.partNumber} ${name}` : name;
}
