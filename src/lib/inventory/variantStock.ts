import { type StoredPieces, countPieces, stepStock } from "./stock";
import { type ItemVariant, countVariants, countingSum, stepVariants } from "./variants";

// What a − / + or a typed count does to an item on the page before the save answers, the way
// lib/inventory/moves.ts will: an item with variants moves the variant (or its first counting one).
type Stocked = { inStock: number; sheet: boolean; pieces: StoredPieces; specs: Record<string, string>; name: string; category?: string | null; variants?: ItemVariant[] };
const tempId = () => `new-${Math.random().toString(36).slice(2)}`;

export function stepItem(item: Stocked, delta: number, size: string | undefined, variantId: string | undefined, uncounted: Set<string>) {
  if (!item.variants?.length || item.sheet) return stepStock(item, delta, size);
  const variants = stepVariants(item.variants, Math.round(delta), uncounted, variantId, tempId);
  return { inStock: countingSum(variants, uncounted), variants };
}

export function countItem(item: Stocked, amount: number, uncounted: Set<string>, variantId?: string) {
  if (!item.variants?.length || item.sheet) return countPieces(item, amount);
  const variants = countVariants(item.variants, Math.round(amount), uncounted, variantId, tempId);
  return { inStock: countingSum(variants, uncounted), variants };
}
