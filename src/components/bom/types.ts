import type { FabLock } from "@/lib/data/parts";
import type { MatchReason } from "@/lib/inventory/match";
import type { PartRow } from "@/lib/parts/changes";

// The shelf behind a part linked to an inventory item: the item's stock, what every active robot
// needs of it, how much of this part it covers, and what's left over. A COTS part with no item
// gets the item it most likely is instead.
// `need` is the robots' (every active robot's linked parts); `total` the item's whole need, the
// bigger of that and its Needed for Season. `restock`: the part is a card Inventory sent to refill
// the shelf, and `met` says the shelf already has the item's whole need.
export type Shelf = {
  itemId: string;
  itemName: string;
  sheet: boolean;
  inStock: number;
  need: number;
  total: number;
  covered: number;
  free: number;
  restock: boolean;
  met: boolean;
  thumbUrl: string | null; // the item's picture
};
// `pending`: auto-link (or a member's Claude) suggested it and it waits in To Review; else the
// card's own guess from the part's name, Onshape part or product page.
export type ShelfSuggestion = { itemId: string; itemName: string; inStock: number; sheet: boolean; reason: MatchReason | "review"; pending?: boolean };

// What the BOM views get for each part.
export type CardPart = PartRow & {
  id: string;
  systemId: string;
  systemName: string;
  isManual: boolean;
  onshapeName: string | null;
  lastModifiedAt: Date;
  lastModifiedByName: string | null;
  files: { id: string; type: string; filename: string; onshape?: boolean }[];
  thumbUrl: string | null;
  modelKey: string | null; // the part's key in the robot's 3D model
  onshape?: string | null; // the part in Onshape at the BOM's version (the window's Onshape button)
  geometry?: { onshapeMaterial?: string; sheetMetal?: { flatPartId: string }; wallMm?: number } | null;
  groups: { id: string; name: string; color: string | null }[];
  memberIds?: string[]; // set on a merged row
  fabFinishedAt?: Date | null; // first made (To Fab's Finished section)
  stageAt?: Date | string | null; // when it last arrived in a page's list (src/lib/seen.ts)
  hasDrawing?: boolean; // a fabrication drawing was made for it (system page → Drawings)
  drawingOutdated?: boolean; // the part changed in Onshape since that drawing was made
  shelf?: Shelf | null;
  shelfSuggestion?: ShelfSuggestion | null;
  review?: boolean; // a suggestion (Suggest, auto-link, a member's Claude) waits in To Review
  rounded?: boolean; // that suggestion rounded the material to the nearest stock item (≈)
  fabLock?: FabLock | null; // the state it was released to fab at (plan/fab-version-lock.md)
  // Set on To Fab only: the card shows the locked state, downloads it, and tags a newer BOM change.
  fabView?: { changed: boolean };
  typeWarning?: string | null; // a COTS-typed part that is really made (lib/parts/dataChecks.ts)
  nameCollision?: boolean; // its part number is on a different shape in its system too
  restock?: boolean; // a card Inventory sent to orders: the order pages show it as the item itself
};

// The real part behind a row: a merged row's files and exports belong to its first member.
// The real parts behind a row, space-separated, for [data-part~=id] (Recent actions links).
export const partIds = (p: Pick<CardPart, "id" | "memberIds">) => (p.memberIds ?? [p.id]).join(" ");

export const ownerPartId = (p: Pick<CardPart, "id" | "memberIds">) => p.memberIds?.[0] ?? p.id;

// The app has no part number field: a part goes by its name (the Onshape name unless renamed).
export function partTitle(p: Pick<CardPart, "displayName" | "onshapeName">): string {
  return p.displayName ?? p.onshapeName ?? "Unnamed part";
}
