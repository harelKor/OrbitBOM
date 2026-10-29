import type { InvCategory } from "@/lib/inventory/categories";
import type { OpenOrder } from "@/lib/inventory/season";
import type { ItemUsage } from "@/lib/inventory/usage";

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
  locationId: string | null;
  inStock: number;
  pieces: Record<string, number>; // a fraction item's pieces by size, in twelfths (lib/inventory/stock.ts)
  seasonNeed: number | null;
  note: string | null;
  price: number | null;
  imagePath: string | null;
  usage: ItemUsage | null;
  openOrder: OpenOrder | null;
  sheet: boolean;
  thumbUrl: string | null;
};
export type Group = { id: string; name: string; parentId: string | null; templateId: string | null; locationId: string | null };
export type Condition = { id: string; label: string; color: string };
export type Location = { id: string; name: string; mapX?: number | null; mapY?: number | null };
export type BomTarget = { id: string; name: string; systems: { id: string; name: string }[] };

export type Lookups = { groups: Group[]; conditions: Condition[]; locations: Location[]; categories: InvCategory[] };
