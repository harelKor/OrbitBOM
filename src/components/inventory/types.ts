import type { ItemUsage } from "@/lib/inventory/usage";

// Plain shapes the inventory components get from the page.
export type Item = {
  id: string;
  name: string;
  groupId: string | null;
  templateId: string | null;
  templateValues: Record<string, string>;
  conditionId: string | null;
  locationId: string | null;
  inStock: number;
  material: string | null;
  vendorUrl: string | null;
  vendorName: string | null;
  price: number | null;
  usage: ItemUsage | null;
};
export type Group = { id: string; name: string; parentId: string | null; templateId: string | null; locationId: string | null };
export type Condition = { id: string; label: string; color: string };
export type Location = { id: string; name: string };
export type BomTarget = { id: string; name: string; systems: { id: string; name: string }[] };

export type Lookups = { groups: Group[]; conditions: Condition[]; locations: Location[] };
