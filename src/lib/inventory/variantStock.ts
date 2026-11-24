import { type StoredPieces, countPieces, stepStock } from "./stock";
import { type ItemVariant, type VariantConds, countVariants, countingSum, newStockOf, stepVariants } from "./variants";

// What a − / + or a typed count does to an item on the page before the save answers, the way
// lib/inventory/moves.ts will: an item with variants moves the variant (or its first counting one).
type Stocked = { inStock: number; sheet: boolean; pieces: StoredPieces; specs: Record<string, string>; name: string; category?: string | null; variants?: ItemVariant[] };
const tempId = () => `new-${Math.random().toString(36).slice(2)}`;

export function stepItem(item: Stocked, delta: number, size: string | undefined, variantId: string | undefined, conds: VariantConds) {
  if (!item.variants?.length || item.sheet) return stepStock(item, delta, size);
  return withVariants(stepVariants(item.variants, Math.round(delta), conds.uncounted, variantId, tempId), conds);
}

export function countItem(item: Stocked, amount: number, conds: VariantConds, variantId?: string) {
  if (!item.variants?.length || item.sheet) return countPieces(item, amount);
  return withVariants(countVariants(item.variants, Math.round(amount), conds.uncounted, variantId, tempId), conds);
}

// An item's new variants with the totals the cards read (in_stock, and its New stock).
export const withVariants = (variants: ItemVariant[], conds: VariantConds) => ({ variants, inStock: countingSum(variants, conds.uncounted), newStock: newStockOf(variants, conds.newId) });
