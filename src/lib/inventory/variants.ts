// An item's variants (Harel, 2026-11-24): the same item in several conditions on one shelf, each
// with its own count and short note ("3 New, 2 Worn, 1 Defective"). They live on the item row
// (inventory_items.variants, like a fraction item's pieces), so the item's row lock covers them
// and the shelf's cached read brings them along. Once an item has variants, its stock (in_stock)
// is the sum of the variants whose condition counts; a Defective one is shown but counts toward
// nothing (stock, season need, shortage, ordering). Raw stock never has variants: its pieces
// already cover cut-offs and sizes.
// Plain maths, shared by the server (lib/inventory/moves.ts) and the item window.

export type ItemVariant = { id: string; conditionId: string | null; count: number; note: string | null };

// A condition's "Only for" (Settings → Conditions): category groups and / or categories. Null or
// empty = everywhere.
export type ConditionScope = { groups?: string[]; categories?: string[] } | null;
type ScopedCondition = { onlyFor?: ConditionScope; uncounted?: boolean };

export function scopeFits(scope: ConditionScope | undefined, cat: { id: string; group: string } | null | undefined): boolean {
  if (!scope || (!scope.groups?.length && !scope.categories?.length)) return true;
  if (!cat) return false;
  return !!scope.groups?.includes(cat.group) || !!scope.categories?.includes(cat.id);
}

// The conditions a picker offers for an item: those whose scope fits its category, plus the one it
// already carries (an item that had an out-of-scope condition before scopes keeps it).
export function conditionsFor<C extends ScopedCondition & { id: string }>(conditions: C[], cat: { id: string; group: string } | null | undefined, keep?: (string | null)[]): C[] {
  return conditions.filter((c) => scopeFits(c.onlyFor, cat) || keep?.includes(c.id));
}

// Raw Stock (plates, tubes, shafts, filament) and fraction categories: no variants (Harel).
export const variantsAllowed = (cat: { group: string; sheet?: boolean } | null | undefined) => !!cat && cat.group !== "consumables" && !cat.sheet;

export const storedVariants = (v: unknown): ItemVariant[] => (Array.isArray(v) ? (v as ItemVariant[]) : []);

export const counts = (v: ItemVariant, uncounted: Set<string>) => !v.conditionId || !uncounted.has(v.conditionId);
export const countingSum = (variants: ItemVariant[], uncounted: Set<string>) => variants.reduce((s, v) => s + (counts(v, uncounted) ? v.count : 0), 0);
export const countingVariants = (variants: ItemVariant[], uncounted: Set<string>) => variants.filter((v) => counts(v, uncounted));

// A stock move on an item with variants. It lands on the variant named when that one counts,
// else on the first counting one; a take bigger than that variant goes on to the next counting
// ones. A + with no counting variant at all (every one Defective) starts a new one with no
// condition. lib/inventory/moves.ts logs one move per variant whose counting amount changed.
export function stepVariants(variants: ItemVariant[], delta: number, uncounted: Set<string>, variantId: string | null | undefined, newId: () => string): ItemVariant[] {
  const next = variants.map((v) => ({ ...v }));
  const named = next.find((v) => v.id === variantId && counts(v, uncounted));
  const order = [...(named ? [named] : []), ...next.filter((v) => v !== named && counts(v, uncounted))];
  if (delta > 0) {
    let target = order[0];
    if (!target) {
      target = { id: newId(), conditionId: null, count: 0, note: null };
      next.push(target);
    }
    target.count += delta;
  } else {
    let left = -delta;
    for (const v of order) {
      if (left <= 0) break;
      const take = Math.min(v.count, left);
      v.count -= take;
      left -= take;
    }
  }
  return next;
}

// A counted total (the item form, a stocktake) on an item with variants: the difference from
// today's counting total, stepped as above. A count of one named variant sets that variant (a
// Defective one too, which moves no stock).
export function countVariants(variants: ItemVariant[], amount: number, uncounted: Set<string>, variantId: string | null | undefined, newId: () => string): ItemVariant[] {
  const to = Math.max(0, amount);
  if (variants.some((v) => v.id === variantId)) return variants.map((v) => (v.id === variantId ? { ...v, count: to } : v));
  return stepVariants(variants, to - countingSum(variants, uncounted), uncounted, null, newId);
}

// The item window's edits to its variants.
export type VariantOp =
  | { add: { conditionId: string | null; count: number; note?: string | null } }
  | { set: { id: string; conditionId?: string | null; count?: number; note?: string | null } }
  | { remove: string }
  // An item without variants put in a condition that counts toward nothing (Defective): its whole
  // stock becomes one variant in it, so it leaves the stock.
  | { whole: string };

// Apply an edit. The first + Add variant turns the item's current stock into a first variant in
// its current condition, so nothing is lost. Removing the last variant folds it back into the
// item's plain stock (`conditionId`: the condition to give the item back).
export function applyVariantOp(item: { inStock: number; conditionId: string | null; variants: ItemVariant[] }, op: VariantOp, newId: () => string): { variants: ItemVariant[]; conditionId?: string | null } {
  const list = item.variants.map((v) => ({ ...v }));
  if ("add" in op) {
    if (!list.length) list.push({ id: newId(), conditionId: item.conditionId, count: Math.max(0, item.inStock), note: null });
    list.push({ id: newId(), conditionId: op.add.conditionId, count: Math.max(0, op.add.count), note: op.add.note?.trim() || null });
    return { variants: list };
  }
  if ("whole" in op) return { variants: list.length ? list : [{ id: newId(), conditionId: op.whole, count: Math.max(0, item.inStock), note: null }] };
  if ("set" in op) {
    return {
      variants: list.map((v) =>
        v.id !== op.set.id
          ? v
          : {
              ...v,
              ...(op.set.conditionId !== undefined && { conditionId: op.set.conditionId }),
              ...(op.set.count !== undefined && { count: Math.max(0, op.set.count) }),
              ...(op.set.note !== undefined && { note: op.set.note?.trim() || null }),
            },
      ),
    };
  }
  const gone = list.find((v) => v.id === op.remove);
  const rest = list.filter((v) => v.id !== op.remove);
  if (gone && !rest.length) return { variants: [], conditionId: gone.conditionId };
  return { variants: rest };
}

// Each variant's change in counted stock between two lists (removed ones go to 0). `broke`: it
// stopped counting (marked Defective), so its move is "broke" rather than "counted".
export function variantMoves(before: ItemVariant[], after: ItemVariant[], uncounted: Set<string>) {
  const amount = (v: ItemVariant | undefined) => (v && counts(v, uncounted) ? v.count : 0);
  const ids = [...new Set([...before.map((v) => v.id), ...after.map((v) => v.id)])];
  return ids.flatMap((id) => {
    const a = before.find((v) => v.id === id);
    const b = after.find((v) => v.id === id);
    const delta = amount(b) - amount(a);
    return delta ? [{ variantId: id, delta, broke: delta < 0 && !!a && !!b && counts(a, uncounted) && !counts(b, uncounted) }] : [];
  });
}

// The conditions whose stock counts toward nothing, from a conditions list (the page's lookups).
export const uncountedOf = (conditions: { id: string; uncounted?: boolean }[]) => new Set(conditions.filter((c) => c.uncounted).map((c) => c.id));

// The New condition, and how many of an item's variants are in it: a season need can ask for
// some of them New (inventory_items.season_need_new, Harel 2026-11-24).
export const newIdOf = (conditions: { id: string; label: string }[]) => conditions.find((c) => c.label.trim().toLowerCase() === "new")?.id ?? null;
export const newStockOf = (variants: unknown, newId: string | null) => (newId ? storedVariants(variants).reduce((s, v) => s + (v.conditionId === newId ? v.count : 0), 0) : 0);

// What the page's optimistic stock changes need to know about the conditions.
export type VariantConds = { uncounted: Set<string>; newId: string | null };
export const variantConds = (conditions: { id: string; label: string; uncounted?: boolean }[]): VariantConds => ({ uncounted: uncountedOf(conditions), newId: newIdOf(conditions) });

// Whether an item is in a condition: its own, or any of its variants' (filters, condition pages).
export const inCondition = (item: { conditionId: string | null; variants?: ItemVariant[] }, conditionId: string) =>
  item.variants?.length ? item.variants.some((v) => v.conditionId === conditionId) : item.conditionId === conditionId;
