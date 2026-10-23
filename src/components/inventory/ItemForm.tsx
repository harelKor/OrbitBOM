"use client";

import { useState, useTransition } from "react";
import { saveItem } from "@/app/(app)/inventory/actions";
import { buildName, getCategory } from "@/lib/inventory/categories";
import { formatStock, parseStock } from "@/lib/inventory/stock";
import { Chips, FieldInput } from "./fields";
import { hostOf } from "./ItemCard";
import type { Condition, InvCategory, Item, Location } from "./types";

export type Draft = {
  category: string | null;
  specs: Record<string, string>;
  name: string;
  nameTouched: boolean;
  inStock: string;
  locationId: string | null;
  locationTouched: boolean;
  conditionId: string | null;
  links: { url: string; site?: string }[];
  price: number | null;
  imageUrl: string | null;
};

export const emptyDraft = (over: Partial<Draft> = {}): Draft => ({
  category: null,
  specs: {},
  name: "",
  nameTouched: false,
  inStock: "1",
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
  onCancel,
}: {
  itemId: string | null;
  draft: Draft;
  setDraft: (d: Draft) => void;
  categories: InvCategory[];
  locations: Location[];
  conditions: Condition[];
  items: Pick<Item, "category" | "locationId">[];
  onSaved: (id: string, message?: string) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [linkText, setLinkText] = useState("");
  const cat = getCategory(categories, d.category);
  const built = cat ? buildName(cat, d.specs) : "";
  const name = d.nameTouched || !built ? d.name : built;
  const sheet = !!cat?.sheet;

  const pickCategory = (id: string | null) => {
    const next = getCategory(categories, id);
    setDraft({ ...d, category: id, locationId: d.locationTouched ? d.locationId : categoryLocation(next, items) });
  };
  const setSpec = (field: string, value: string) => setDraft({ ...d, specs: { ...d.specs, [field]: value } });
  const step = (by: number) => {
    const n = parseStock(d.inStock, sheet) ?? 0;
    setDraft({ ...d, inStock: formatStock(Math.max(0, n + by), sheet) });
  };
  const submit = () =>
    startTransition(async () => {
      setError(null);
      const links = linkText.trim() ? [...d.links, { url: linkText.trim() }] : d.links;
      const r = await saveItem(itemId, {
        name: name.trim(),
        category: d.category,
        specs: d.specs,
        inStock: d.inStock,
        conditionId: d.conditionId,
        locationId: d.locationId,
        links,
        price: d.price,
        imageUrl: d.imageUrl,
      });
      if (r.error || !r.id) setError(r.error ?? "Couldn't save.");
      else onSaved(r.id, r.message);
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
    >
      <div>
        <div className="label">Category</div>
        <Chips size="lg" options={categories.map((c) => c.label)} value={cat?.label ?? ""} onPick={(label) => pickCategory(categories.find((c) => c.label === label)?.id ?? null)} />
      </div>

      {cat && cat.fields.some((f) => !f.hidden) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {cat.fields
            .filter((f) => !f.hidden)
            .map((f, i) => (
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
          onChange={(e) => setDraft({ ...d, name: e.target.value, nameTouched: true })}
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
          <div className="label">{sheet ? "Sheets" : "Quantity"}</div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => step(-1)} className="press flex h-11 w-11 items-center justify-center rounded-lg bg-rose-500 text-xl font-bold text-white hover:bg-rose-400" aria-label="One less">
              −
            </button>
            <input
              value={d.inStock}
              onChange={(e) => setDraft({ ...d, inStock: e.target.value })}
              inputMode={sheet ? "text" : "numeric"}
              aria-label="In stock"
              className="input min-h-11 w-20 text-center font-mono text-lg tabular-nums"
            />
            <button type="button" onClick={() => step(1)} className="press flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-500 text-xl font-bold text-white hover:bg-emerald-400" aria-label="One more">
              +
            </button>
          </div>
        </div>
        <div className="min-w-40 flex-1">
          <label className="label" htmlFor="item-location">
            Location
          </label>
          <select id="item-location" value={d.locationId ?? ""} onChange={(e) => setDraft({ ...d, locationId: e.target.value || null, locationTouched: true })} className="input min-h-11">
            <option value="">Not set</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
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
        <div className="label">Product</div>
        {(d.links.length > 0 || d.imageUrl) && (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-2">
            {d.imageUrl && (
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
        <div className="flex gap-2">
          <input type="url" value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder={d.links.length ? "Another product link…" : "Product link (optional)"} className="input min-h-11 flex-1" />
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
      <div className="flex justify-end gap-2">
        <button type="button" className="btn min-h-11" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary min-h-11 px-5" disabled={pending || !name.trim()}>
          {pending ? "Saving…" : itemId ? "Save" : "Add to inventory"}
        </button>
      </div>
    </form>
  );
}
