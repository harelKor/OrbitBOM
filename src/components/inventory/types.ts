import type { InvCategory } from "@/lib/inventory/categories";
import type { Place } from "@/lib/inventory/places";
import type { OpenOrder } from "@/lib/inventory/season";
import type { ItemUsage } from "@/lib/inventory/usage";
import type { StoredPieces } from "@/lib/inventory/stock";
import type { ConditionScope, ItemVariant } from "@/lib/inventory/variants";

export type { InvCategory };

// Plain shapes the inventory components get from the page.
export type Item = {
  id: string;
  name: string;
  groupId: string | null;
  category: string; // resolved: set, or guessed from the name
  categorySet: string | null;
  specs: Record<string, string>;
  cotsLinks: { url: string; site?: string; priceUsd?: number }[];
  conditionId: string | null;
  // The item in several conditions (lib/inventory/variants.ts); empty: one stock in conditionId.
  variants: ItemVariant[];
  locationId: string | null;
  inStock: number;
  pieces: StoredPieces; // a fraction item's piece sizes and counts (lib/inventory/stock.ts)
  seasonNeed: number | null;
  // How many of the season need must be New, and its New variants' count (Harel, 2026-11-24).
  seasonNeedNew: number | null;
  newStock: number;
  note: string | null;
  seasonTag: "2026" | "2027"; // red 2026: last season's list; green 2027: checked for this season
  price: number | null;
  usage: ItemUsage | null;
  openOrder: OpenOrder | null;
  sheet: boolean;
  thumbUrl: string | null;
  station?: string | null; // one of the three PC stations (config/stations.ts)
};
export type Group = { id: string; name: string; parentId: string | null; templateId: string | null; locationId: string | null };
// `onlyFor`: offered only on items in these category groups / categories; `uncounted`: its stock
// counts toward nothing (Defective). lib/inventory/variants.ts.
export type Condition = { id: string; label: string; color: string; onlyFor?: ConditionScope; uncounted?: boolean };
// A zone or a drawer / shelf on the shop map (lib/inventory/places.ts).
export type Location = Place;
export type BomTarget = { id: string; name: string; systems: { id: string; name: string }[] };

export type Lookups = { groups: Group[]; conditions: Condition[]; locations: Location[]; categories: InvCategory[] };
