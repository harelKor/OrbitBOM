"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { StepButton } from "@/components/ui/Stepper";
import { askConfirm } from "@/components/ui/useConfirm";
import { useCan } from "@/components/shell/ModeContext";
import { textOn } from "@/components/bom/options";
import { type ItemVariant, type VariantOp, applyVariantOp, conditionsFor, countingVariants, counts, uncountedOf, variantConds, variantsAllowed } from "@/lib/inventory/variants";
import { stepItem, withVariants } from "@/lib/inventory/variantStock";
import { adjustStock, editItemVariants } from "@/app/(app)/inventory/actions";
import { CountBox, conditionColor } from "./ItemCard";
import { ConditionSelect } from "./ConditionSelect";
import type { Condition, InvCategory, Item } from "./types";

// An item's variants (lib/inventory/variants.ts, Harel 2026-11-24): the same item in several
// conditions, each with its own count and note. Cards, rows and the item window show them as a
// compact summary of coloured condition dots with counts, in place of the single condition tag.

const NO_CONDITION = "#94a3b8";
const colorOf = (conditions: Condition[], id: string | null) => {
  const c = conditions.find((x) => x.id === id);
  return c ? conditionColor(c.color) : NO_CONDITION;
};
const labelOf = (conditions: Condition[], id: string | null) => conditions.find((x) => x.id === id)?.label ?? "No condition";

export function VariantDots({ variants, conditions, className = "" }: { variants: ItemVariant[]; conditions: Condition[]; className?: string }) {
  const unc = uncountedOf(conditions);
  const title = variants.map((v) => `${v.count} ${labelOf(conditions, v.conditionId)}${counts(v, unc) ? "" : " (not counted)"}`).join(", ");
  return (
    <span title={title} aria-label={title} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#111318]/85 px-2 py-0.5 font-mono text-[0.6875rem] font-semibold text-white tabular-nums ${className}`}>
      {variants.map((v) => (
        <span key={v.id} className={`inline-flex items-center gap-0.5 ${counts(v, unc) ? "" : "opacity-60"}`}>
          <span className="h-2 w-2 rounded-full" style={{ background: colorOf(conditions, v.conditionId) }} aria-hidden />
          {v.count}
        </span>
      ))}
    </span>
  );
}

// − / + on a card or row of an item with variants: with more than one counting variant a small
// popup asks which, in their condition colours; with one the step goes straight to it.
export function useVariantStep(item: Pick<Item, "variants" | "sheet">, conditions: Condition[] | undefined, onStep: (delta: number, size?: string, variantId?: string) => void) {
  const [ask, setAsk] = useState<{ delta: number; x: number; y: number } | null>(null);
  const counting = item.sheet ? [] : countingVariants(item.variants ?? [], uncountedOf(conditions ?? []));
  const step = (delta: number, e?: React.MouseEvent<HTMLElement>) => {
    if (counting.length <= 1) return onStep(delta, undefined, counting[0]?.id);
    const r = e?.currentTarget.getBoundingClientRect();
    setAsk({ delta, x: r ? r.left + r.width / 2 : window.innerWidth / 2, y: r ? r.top : window.innerHeight / 2 });
  };
  useEffect(() => {
    if (!ask) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAsk(null);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", () => setAsk(null), { once: true, capture: true });
    return () => window.removeEventListener("keydown", esc);
  }, [ask]);
  const chooser =
    ask &&
    createPortal(
      <div className="fixed inset-0 z-[100]" onClick={(e) => (e.stopPropagation(), setAsk(null))} onPointerDown={(e) => e.stopPropagation()}>
        <div
          role="menu"
          aria-label={ask.delta > 0 ? "Add to which variant?" : "Take from which variant?"}
          className="panel absolute w-52 -translate-x-1/2 -translate-y-full space-y-1 p-1.5 shadow-xl"
          style={{ left: Math.min(Math.max(ask.x, 110), window.innerWidth - 110), top: Math.max(ask.y - 6, 8 + 40 * counting.length) }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-1.5 pt-0.5 text-[0.6875rem] font-semibold text-muted">{ask.delta > 0 ? "Add to" : "Take from"}</p>
          {counting.map((v) => {
            const color = colorOf(conditions ?? [], v.conditionId);
            return (
              <button
                key={v.id}
                type="button"
                role="menuitem"
                disabled={ask.delta < 0 && v.count < 1}
                onClick={() => {
                  setAsk(null);
                  onStep(ask.delta, undefined, v.id);
                }}
                className="press flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-raised active:scale-[0.98] disabled:opacity-40"
              >
                <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: color, color: textOn(color) }}>
                  {labelOf(conditions ?? [], v.conditionId)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{v.note}</span>
                <span className="font-mono font-semibold tabular-nums">{v.count}</span>
              </button>
            );
          })}
        </div>
      </div>,
      document.body,
    );
  return { step, chooser };
}

type ChangeItem = (change: (i: Item) => Partial<Item>, run: () => Promise<{ error?: string }>) => void;

// The item window's variants, under the stock count: each one's condition, − count +, note and ✕,
// and + Add variant. Raw Stock and PC stations have none.
export function VariantsSection({
  item,
  cat,
  conditions,
  onChange,
  onSave,
}: {
  item: Item;
  cat: InvCategory | undefined;
  conditions: Condition[];
  onChange: ChangeItem;
  // Saves that add or remove a variant reload the item (the server makes the new ids).
  onSave: (run: () => Promise<{ error?: string }>) => void;
}) {
  const work = useCan("work");
  const variants = item.variants ?? [];
  if (item.station || !variantsAllowed(cat) || (!work && !variants.length)) return null;
  const conds = variantConds(conditions);
  const unc = conds.uncounted;
  const set = (op: VariantOp) =>
    onChange(
      (i) => withVariants(applyVariantOp(i, op, () => "new").variants, conds),
      () => editItemVariants(item.id, op),
    );
  // A counting variant's − / + is a stock move (a step, so two phones tapping both count); a
  // Defective one's just sets its count.
  const step = (v: ItemVariant, delta: number) =>
    counts(v, unc)
      ? onChange((i) => stepItem(i, delta, undefined, v.id, conds), () => adjustStock(item.id, delta, undefined, v.id))
      : set({ set: { id: v.id, count: Math.max(0, v.count + delta) } });
  const add = () => {
    const used = new Set(variants.map((v) => v.conditionId));
    // The first add also keeps today's stock as a variant in the item's condition.
    if (!variants.length) used.add(item.conditionId);
    const offered = conditionsFor(conditions, cat);
    const next = offered.find((c) => !used.has(c.id) && !c.uncounted) ?? offered.find((c) => !used.has(c.id));
    onSave(() => editItemVariants(item.id, { add: { conditionId: next?.id ?? null, count: 0 } }));
  };
  return (
    <div className="space-y-1.5">
      {variants.length > 0 && (
        <ul className="space-y-1.5">
          {variants.map((v) => {
            const color = colorOf(conditions, v.conditionId);
            const known = conditions.some((c) => c.id === v.conditionId);
            const offered = conditionsFor(conditions, cat, [v.conditionId]);
            return (
              <li key={v.id} className={`flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 ${counts(v, unc) ? "" : "opacity-80"}`}>
                {work ? (
                  <ConditionSelect
                    conditions={offered}
                    value={known ? v.conditionId : null}
                    onChange={(conditionId) => set({ set: { id: v.id, conditionId } })}
                    emptyLabel="Condition"
                    className="press cursor-pointer appearance-none rounded-full border border-transparent px-2.5 py-0.5 pr-3 text-xs font-semibold hover:brightness-110"
                    style={{ backgroundColor: color, color: textOn(color) }}
                  />
                ) : (
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: color, color: textOn(color) }}>
                    {labelOf(conditions, v.conditionId)}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  {work && <StepButton step={-1} onClick={() => step(v, -1)} disabled={v.count < 1} label={`One less ${labelOf(conditions, v.conditionId)}`} />}
                  <span className="min-w-8 text-center font-mono text-sm font-semibold tabular-nums">
                    <CountBox item={{ inStock: v.count, sheet: false }} onCount={(n) => set({ set: { id: v.id, count: Math.round(n) } })} />
                  </span>
                  {work && <StepButton step={1} onClick={() => step(v, 1)} label={`One more ${labelOf(conditions, v.conditionId)}`} />}
                </span>
                {!counts(v, unc) && <span className="text-[0.6875rem] text-muted">not counted</span>}
                {work ? (
                  <NoteInput key={v.note ?? ""} value={v.note ?? ""} onSave={(note) => set({ set: { id: v.id, note } })} />
                ) : (
                  v.note && <span className="min-w-0 flex-1 truncate text-xs text-muted">{v.note}</span>
                )}
                {work && (
                  <button
                    type="button"
                    className="press ml-auto flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-rose-500 active:scale-[0.98] pointer-coarse:h-9 pointer-coarse:w-9"
                    aria-label={`Remove the ${labelOf(conditions, v.conditionId)} variant`}
                    title="Remove this variant"
                    onClick={async () => {
                      const last = variants.length === 1;
                      if (
                        v.count > 0 &&
                        !last &&
                        !(await askConfirm({ title: `Remove the ${labelOf(conditions, v.conditionId)} variant?`, body: counts(v, unc) ? `Its ${v.count} leave the stock.` : undefined, confirm: "Remove", danger: true }))
                      )
                        return;
                      onSave(() => editItemVariants(item.id, { remove: v.id }));
                    }}
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {work && (
        <button type="button" onClick={add} className="press rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs font-semibold text-muted hover:border-sky-400/40 hover:text-accent active:scale-[0.98] pointer-coarse:min-h-9">
          + Add variant
        </button>
      )}
    </div>
  );
}

// A variant's short note, saved when the box loses focus.
function NoteInput({ value, onSave }: { value: string; onSave: (v: string | null) => void }) {
  const [text, setText] = useState(value);
  return (
    <input
      value={text}
      maxLength={200}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== value && onSave(text.trim() || null)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder="Note"
      aria-label="Variant note"
      className="input min-h-8 min-w-24 flex-1 py-0.5 text-xs pointer-coarse:min-h-9"
    />
  );
}
