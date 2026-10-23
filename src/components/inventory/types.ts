import type { InvCategory } from "@/lib/inventory/categories";
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
  price: number | null;
  imagePath: string | null;
  usage: ItemUsage | null;
  sheet: boolean;
  thumbUrl: string | null;
};
export type Group = { id: string; name: string; parentId: string | null; templateId: string | null; locationId: string | null };
export type Condition = { id: string; label: string; color: string };
export type Location = { id: string; name: string };
export type BomTarget = { id: string; name: string; systems: { id: string; name: string }[] };

export type Lookups = { groups: Group[]; conditions: Condition[]; locations: Location[]; categories: InvCategory[] };
