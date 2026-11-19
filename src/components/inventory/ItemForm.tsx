"use client";

import { StepButton } from "@/components/ui/Stepper";
import { useState, useTransition } from "react";
import { saveItem, type ItemInput } from "@/app/(app)/inventory/actions";
import { CATEGORY_GROUPS, type CategoryGroupId } from "@/config/inventory";
import { activeFields, buildName, dropInactive, getCategory } from "@/lib/inventory/categories";
import { formatStockExact as formatStock, isSheetGoods, parseStock } from "@/lib/inventory/stock";
import { useCan } from "@/components/shell/ModeContext";
import { FieldInput } from "./fields";
import { hostOf } from "./ItemCard";
import { LocationPicker, PlaceTag } from "./LocationPicker";
import { PhotoButtons } from "./photo";
import { ProductPicker, type ChosenProduct } from "./ProductSearch";
import type { Condition, InvCategory, Item, Location } from "./types";

export type Draft = {
  category: string | null;
  specs: Record<string, string>;
  name: string;
  nameTouched: boolean; // the name box wins over the name the specs build
  nameTyped?: boolean; // typed in the name box during this edit
  inStock: string;
  inStockLoaded?: string; // the count the edit started from: left as it is, the save doesn't count it again
  locationId: string | null;
  locationTouched: boolean;
  conditionId: string | null;
  links: { url: string; site?: string }[];
  price: number | null;
  imageUrl: string | null;
  photo?: { key: string; preview: string } | null; // a photo the member took or uploaded
};

export const emptyDraft = (over: Partial<Draft> = {}): Draft => ({
  category: null,
  specs: {},
  name: "",
  nameTouched: false,
  inStock: "0",
  locationId: null,
  locationTouched: false,
  conditionId: null,
  links: [],
  price: null,
  imageUrl: null,
  ...over,
});

export const draftOf = (item: Item): Draft => ({
  category: item.categorySet ?? item.category,
  specs: item.specs,
  name: item.name,
  nameTouched: true,
  inStock: formatStock(item.inStock, item.sheet),
  inStockLoaded: formatStock(item.inStock, item.sheet),
  locationId: item.locationId,
  locationTouched: true,
  conditionId: item.conditionId,
  links: item.cotsLinks,
  price: item.price,
  imageUrl: null,
});

// Where a category's items go: the location set in the category settings, else the shelf where
// most of its items already sit.
export function categoryLocation(cat: InvCategory | undefined, items: Pick<Item, "category" | "locationId">[]) {
  if (!cat) return null;
  if (cat.defaultLocationId) return cat.defaultLocationId;
  const count = new Map<string, number>();
  for (const i of items) if (i.category === cat.id && i.locationId) count.set(i.locationId, (count.get(i.locationId) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// Adding or editing an item in a few taps: the category's fields (chips or type-to-filter
// dropdowns), the name builds itself, the location follows the category, then the quantity.
// Enter saves.
export function ItemForm({
  itemId,
  draft: d,
  setDraft,
  categories,
  locations,
  conditions,
  items,
  onSaved,
  onSubmit,
  onCancel,
  onDelete,
}: {
  itemId: string | null;
  draft: Draft;
  setDraft: (d: Draft) => void;
  categories: InvCategory[];
  locations: Location[];
  conditions: Condition[];
  items: Pick<Item, "category" | "locationId">[];
  onSaved: (id: string, message?: string) => void;
  onSubmit?: (input: ItemInput) => void; // the add box saves it itself, so the form closes at once
  onCancel: () => void;
  // The item window's Delete (any team member, Harel 2026-11-19): it confirms, deletes and closes the window.
  onDelete?: () => void | Promise<void>;
}) {
  const discard = useCan("discard");
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cat = getCategory(categories, d.category);
  const built = cat ? buildName(cat, d.specs) : "";
  const name = d.nameTouched || !built ? d.name : built;
  const sheet = !!cat?.sheet;

  const pickCategory = (id: string | null) => {
    const next = getCategory(categories, id);
    setDraft({ ...d, category: id, locationId: d.locationTouched ? d.locationId : categoryLocation(next, items) });
  };
  // Picking another sub-type clears the values of fields the new one doesn't have.
  // Changing a spec renames the item from its specs, an item being edited too (its name starts as
  // the saved one): unless the member typed in the name box during this edit (Harel, 2026-11-06).
  const setSpec = (field: string, value: string) => {
    const specs = { ...d.specs, [field]: value };
    setDraft({ ...d, specs: cat && field === cat.fields[0]?.id ? dropInactive(cat, specs) : specs, nameTouched: d.nameTyped ? d.nameTouched : false });
  };
  const fields = cat ? activeFields(cat, d.specs) : [];
  const step = (by: number) => {
    const n = parseStock(d.inStock, sheet) ?? 0;
    setDraft({ ...d, inStock: formatStock(Math.max(0, n + by), sheet) });
  };
  // A picked store result or a pasted link joins the links, and brings its price and picture.
  const chooseProduct = (p: ChosenProduct, note?: string) => {
    setDraft({
      ...d,
      links: [...d.links.filter((l) => l.url !== p.url), { url: p.url, ...(p.site ? { site: p.site } : {}) }],
      price: p.price ?? d.price,
      imageUrl: p.imageUrl ?? d.imageUrl,
    });
    setError(note ?? null);
    return true;
  };
  const submit = () => {
    const input: ItemInput = {
      name: name.trim(),
      category: d.category,
      specs: d.specs,
      // An untouched count box sends nothing, so − / + taps made meanwhile (here or on another
      // phone) aren't overwritten by the count this form loaded.
      inStock: itemId && d.inStockLoaded !== undefined && d.inStock.trim() === d.inStockLoaded ? undefined : d.inStock,
      conditionId: d.conditionId,
      locationId: d.locationId,
      links: d.links,
      price: d.price,
      imageUrl: d.imageUrl,
      photoKey: d.photo?.key ?? null,
    };
    if (onSubmit) return onSubmit(input);
    startTransition(async () => {
      setError(null);
      const r = await saveItem(itemId, input);
      if (r.error || !r.id) setError(r.error ?? "Couldn't save.");
      else onSaved(r.id, r.message);
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <CategoryPicker categories={categories} value={cat} onPick={pickCategory} />

      {cat && fields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f, i) => (
              <div key={f.id} className={f.kind === "options" && (f.options?.length ?? 0) <= 6 ? "sm:col-span-2" : ""}>
                <div className="label">{f.label}</div>
                <FieldInput field={f} categoryId={cat.id} value={d.specs[f.id] ?? ""} onChange={(v) => setSpec(f.id, v)} autoFocus={i === 0 && !itemId && f.kind === "number"} />
              </div>
            ))}
        </div>
      )}

      <div>
        <label className="label" htmlFor="item-name">
          Name *
        </label>
        <input
          id="item-name"
          required
          value={name}
          onChange={(e) => setDraft({ ...d, name: e.target.value, nameTouched: true, nameTyped: true })}
          placeholder={cat ? `Fill the fields or type a name` : "e.g. 608 bearing"}
          className="input min-h-11 text-base"
        />
        {built && d.nameTouched && built !== d.name && (
          <button type="button" className="mt-1 text-xs text-accent hover:underline" onClick={() => setDraft({ ...d, nameTouched: false })}>
            Use &ldquo;{built}&rdquo;
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="label">{sheet && isSheetGoods(cat?.label ?? d.name) ? "Sheets" : "Quantity"}</div>
          <div className="flex items-center gap-1.5">
            <StepButton step={-1} size="lg" onClick={() => step(-1)} />
            <input
              value={d.inStock}
              onChange={(e) => setDraft({ ...d, inStock: e.target.value })}
              inputMode={sheet ? "text" : "numeric"}
              aria-label="In stock"
              className="input min-h-11 w-20 text-center font-mono text-lg tabular-nums"
            />
            <StepButton step={1} size="lg" onClick={() => step(1)} />
          </div>
        </div>
        <div className="min-w-40 flex-1">
          <label className="label">
            Place
          </label>
          <LocationPicker
            locations={locations}
            value={d.locationId}
            onChange={(id) => setDraft({ ...d, locationId: id, locationTouched: true })}
            className="input flex min-h-11 w-full items-center text-left active:scale-[0.98]"
            choices={d.locationId ? [{ value: null, label: "Not set" }] : []}
          >
            <PlaceTag place={locations.find((l) => l.id === d.locationId)} places={locations} /> <span className="ml-auto text-subtle">▾</span>
          </LocationPicker>
        </div>
        <div className="min-w-36">
          <label className="label" htmlFor="item-condition">
            Condition
          </label>
          <select id="item-condition" value={d.conditionId ?? ""} onChange={(e) => setDraft({ ...d, conditionId: e.target.value || null })} className="input min-h-11">
            <option value="">Not set</option>
            {conditions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="label">Photo</div>
        <div className="flex flex-wrap items-center gap-3">
          {(d.photo || d.imageUrl) && (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview or the store's picture, saved to R2 on save
            <img src={d.photo?.preview ?? d.imageUrl!} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-line bg-white object-contain" />
          )}
          <PhotoButtons onPhoto={(photo) => setDraft({ ...d, photo })} />
          {d.photo && (
            <button type="button" className="text-xs text-subtle hover:text-rose-600" onClick={() => setDraft({ ...d, photo: null })}>
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="label">Product</div>
        {(d.links.length > 0 || d.imageUrl) && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-2">
            {d.imageUrl && !d.photo && (
              // eslint-disable-next-line @next/next/no-img-element -- the store's picture, saved to R2 on save
              <img src={d.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-white object-contain" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              {d.links.map((l, i) => (
                <div key={l.url} className="flex min-w-0 items-center gap-2 text-sm">
                  <a href={l.url} target="_blank" rel="noreferrer" className="truncate text-sky-600 hover:underline">
                    {l.site || hostOf(l.url)} ↗
                  </a>
                  <button type="button" className="press ml-auto text-subtle hover:text-rose-600" aria-label="Remove link" onClick={() => setDraft({ ...d, links: d.links.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <ProductPicker
              initial={name}
              autoFocus={false}
              actionLabel="Add"
              placeholder={d.links.length ? "Another product: search or paste a link" : "Search stores or paste a product link"}
              onChoose={chooseProduct}
            />
          </div>
          <input
            type="number"
            min={0}
            step="0.01"
            value={d.price ?? ""}
            onChange={(e) => setDraft({ ...d, price: e.target.value === "" ? null : Number(e.target.value) })}
            placeholder="$ each"
            aria-label="Price in dollars"
            className="input min-h-11 w-28 font-mono tabular-nums"
          />
        </div>
      </div>

      {error && <p className="text-sm text-rose-700">{error}</p>}
      {/* On phones the buttons stay at the bottom of the sheet, Add full width. */}
      <div className="flex items-center justify-end gap-2 max-sm:sticky max-sm:bottom-0 max-sm:z-[1] max-sm:-mx-4 max-sm:border-t max-sm:border-line max-sm:bg-surface max-sm:px-4 max-sm:py-3">
        {itemId && onDelete && discard && (
          <button type="button" className="btn mr-auto min-h-11 text-rose-700 active:scale-[0.98]" disabled={deleting} onClick={() => startDelete(async () => void (await onDelete()))}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
        <button type="button" className="btn min-h-11 active:scale-[0.98]" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary min-h-11 px-5 active:scale-[0.98] max-sm:flex-1" disabled={pending || !name.trim()}>
          {pending ? "Saving…" : itemId ? "Save" : "Add to inventory"}
        </button>
      </div>
    </form>
  );
}

// The category, in two short rows instead of every category at once: the 5 groups, then the
// categories of the open group. Once one is picked it's a single pill with "Change", so the
// fields sit right under it (Harel, 2026-10-29: the form is filled on phones while counting).
function CategoryPicker({ categories, value, onPick }: { categories: InvCategory[]; value: InvCategory | undefined; onPick: (id: string | null) => void }) {
  const groups = CATEGORY_GROUPS.filter((g) => categories.some((c) => c.group === g.id));
  const [changing, setChanging] = useState(!value);
  const [group, setGroup] = useState<CategoryGroupId | undefined>(value?.group ?? groups[0]?.id);
  const pill = "press min-h-10 rounded-full border px-3.5 text-sm font-semibold transition-colors duration-150 active:scale-[0.98]";
  if (value && !changing)
    return (
      <div>
        <div className="label">Category</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${pill} inline-flex items-center border-accent bg-accent text-white`}>{value.label}</span>
          <button type="button" onClick={() => setChanging(true)} className={`${pill} border-line-strong text-fg-2 hover:border-sky-400/40 hover:text-accent`}>
            Change category ▾
          </button>
        </div>
      </div>
    );
  return (
    <div className="space-y-2">
      <div className="label">Category</div>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Category group">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={g.id === group}
            onClick={() => setGroup(g.id)}
            className={`${pill} ${g.id === group ? "border-sky-400/60 bg-sky-500/15 text-accent" : "border-line-strong text-fg-2 hover:border-sky-400/40 hover:text-accent"}`}
          >
            {g.short}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-line pt-2">
        {categories
          .filter((c) => c.group === group)
          .map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.id === value?.id}
              onClick={() => {
                onPick(c.id);
                setChanging(false);
              }}
              className={`${pill} ${c.id === value?.id ? "border-accent bg-accent text-white" : "border-line-strong bg-surface text-fg-2 hover:border-sky-400/40 hover:text-accent"}`}
            >
              {c.label}
            </button>
          ))}
        {value && (
          <button type="button" onClick={() => setChanging(false)} className="press min-h-10 px-2 text-sm font-medium text-muted hover:text-fg">
            Keep {value.label}
          </button>
        )}
      </div>
    </div>
  );
}
