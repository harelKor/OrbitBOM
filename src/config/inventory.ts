// The inventory's categories: the boxes on the Inventory page and the sidebar list. The bought
// ones are the COTS page's filter boxes, so a student learns one set of names; a few more only
// make sense on the shelf. Edit here; there is no settings UI. Screws and other small fasteners
// aren't tracked (Harel, 2026-10-22).

import { COTS_CATEGORIES } from "./cots";

type Category = {
  id: string;
  label: string;
  types: string[]; // config/partTypes.ts ids whose items belong here
  match: RegExp | null; // guesses an item's category from its name while none is set
};

const cots = (id: (typeof COTS_CATEGORIES)[number]["id"], types: string[]): Category => {
  const c = COTS_CATEGORIES.find((x) => x.id === id)!;
  return { id: c.id, label: c.label, types, match: c.match };
};

export const INVENTORY_CATEGORIES: Category[] = [
  { id: "bearings", label: "Bearings", types: ["radial-bearings", "flanged-bearings"], match: /bearing|bushing/i },
  cots("motion", ["pulleys", "gears", "sprockets"]),
  cots("belts", ["belts"]),
  cots("motors", []),
  cots("wheels", []),
  { id: "shafts", label: "Shafts", types: [], match: /shaft|hex\s*stock|axle/i },
  cots("round-tubes", ["aluminum-tubes", "polycarbonate-tubes"]),
  cots("square-tubes", ["aluminum-extrusions"]),
  cots("aluminum-plates", ["aluminum-plates"]),
  cots("polycarbonate", ["polycarbonate-plates"]),
  { id: "electrical", label: "Electrical", types: ["wires"], match: /wire|cable|connector|fuse|breaker|spark\s*max|talon|roborio|\bpdh\b|\bpdp\b|battery|encoder/i },
  { id: "filament", label: "Filament", types: ["filament"], match: /filament|\bpla\b|petg|\babs\b|onyx/i },
  { id: "other", label: "Other", types: ["silicone-tubing"], match: null },
];

export type InventoryCategoryId = string;

export const getInventoryCategory = (id: string) => INVENTORY_CATEGORIES.find((c) => c.id === id);

// An item's category: the one set on it, else its part type's, else a guess from its name.
export function inventoryCategoryOf(item: { category: string | null; templateId: string | null; name: string }): string {
  if (item.category && getInventoryCategory(item.category)) return item.category;
  if (item.templateId) {
    const byType = INVENTORY_CATEGORIES.find((c) => c.types.includes(item.templateId!));
    if (byType) return byType.id;
  }
  return INVENTORY_CATEGORIES.find((c) => c.match?.test(item.name))?.id ?? "other";
}
