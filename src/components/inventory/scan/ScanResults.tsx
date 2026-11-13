"use client";

// What Scan found, as it arrives (Harel, 2026-11-13): the specs it settled on (a card with a button
// that opens the add window filled with them), the items already on the shelf, and search results
// from the stores and the whole web, each opening the add window with that product. Everything
// shows together: a shelf match doesn't hide the search results.

import { useState } from "react";
import { guessCategory } from "@/config/inventory";
import { buildName, getCategory } from "@/lib/inventory/categories";
import { normUrl } from "@/lib/inventory/match";
import type { Offer } from "@/lib/inventory/productGroups";
import { parseQuick } from "@/lib/inventory/quick";
import { formatStock } from "@/lib/inventory/stock";
import type { Recognized } from "@/lib/recognize/answer";
import type { Draft } from "../ItemForm";
import type { InvCategory, Item } from "../types";

export type Pending<T> = { loading: boolean; value: T | null; error?: string | null };
// A gear the live counter locked on: its count (and bore shape, not size) without the AI.
export type LiveSpec = { teeth: number; bore: "hex" | "round" | null };

export function ScanResults({
  photo,
  live,
  spec,
  shelf,
  offers,
  categories,
  onNew,
  onOpenItem,
  onAgain,
}: {
  photo: string | null;
  live: LiveSpec | null;
  spec: Pending<Recognized>;
  shelf: Item[];
  offers: Pending<Offer[]>;
  categories: InvCategory[];
  onNew: (draft: Partial<Draft>) => void;
  onOpenItem: (item: Item) => void;
  onAgain: () => void;
}) {
  const r = spec.value;
  // Gears, pulleys and sprockets look alike to the counter: one tap picks which.
  const toothed = categories.filter((c) => c.fields.some((f) => f.id === "teeth"));
  const [picked, setPicked] = useState<string | null>(null);
  const categoryId = picked ?? r?.categoryId ?? (live ? (toothed.find((c) => c.id === "gears") ?? toothed[0])?.id ?? null : null);
  const cat = getCategory(categories, categoryId);
  const specs: Record<string, string> = { ...(r?.specs ?? {}), ...(live && !r?.specs.teeth ? { teeth: String(live.teeth) } : {}) };
  const showChooser = !!cat && toothed.some((c) => c.id === cat.id) && (!r || r.toothed);
  const fields = cat ? cat.fields.filter((f) => !f.hidden && specs[f.id]) : [];
  const name = r?.name || (cat && Object.keys(specs).length ? buildName(cat, specs) : "");

  const fromOffer = (o: Offer): Partial<Draft> => {
    const id = r?.categoryId ?? guessCategory(o.title, categories.map((c) => c.id)) ?? null;
    const c = getCategory(categories, id);
    const read = c ? parseQuick(o.title, [c]) : null;
    return { category: id, specs: { ...(read?.categoryId === id ? read.specs : {}), ...(r?.categoryId === id ? r.specs : {}) }, name: o.title, nameTouched: true, links: [{ url: o.url, site: o.vendor }], price: o.price, imageUrl: o.image };
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL */}
        {photo && <img src={photo} alt="The captured photo" className="h-16 w-16 shrink-0 rounded-lg object-cover" />}
        <span className="flex-1" />
        <button type="button" className="btn min-h-11 active:scale-[0.98]" onClick={onAgain}>
          ↺ Scan again
        </button>
      </div>

      {(spec.loading || r || live || spec.error) && (
        <section className="panel space-y-3 p-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">What it is</h3>
          {spec.loading && !live ? (
            <p className="animate-pulse text-sm text-muted">Reading the part…</p>
          ) : spec.error && !live ? (
            <p className="text-sm text-rose-600">{spec.error}</p>
          ) : (
            <>
              <div>
                <p className="text-lg font-semibold">{name || cat?.label || "Something new"}</p>
                {cat && <p className="text-sm text-muted">{cat.label}{r?.brand ? ` · ${r.brand}` : ""}{r?.partNumber ? ` · ${r.partNumber}` : ""}</p>}
              </div>
              {showChooser && (
                <div className="flex flex-wrap gap-2">
                  {toothed.map((c) => (
                    <button key={c.id} type="button" onClick={() => setPicked(c.id)} aria-pressed={c.id === cat?.id} className={`btn min-h-10 px-3 active:scale-[0.98] ${c.id === cat?.id ? "border-accent bg-accent text-white" : ""}`}>
                      {c.noun || c.label}
                    </button>
                  ))}
                </div>
              )}
              {(fields.length > 0 || live?.bore) && (
                <dl className="flex flex-wrap gap-2">
                  {fields.map((f) => (
                    <div key={f.id} className="rounded-lg border border-line px-2.5 py-1">
                      <dt className="text-[11px] text-muted">{f.label}</dt>
                      <dd className="text-sm font-semibold tabular-nums">{specs[f.id]}</dd>
                    </div>
                  ))}
                  {live?.bore && !specs.bore && (
                    <div className="rounded-lg border border-dashed border-line px-2.5 py-1">
                      <dt className="text-[11px] text-muted">Bore shape</dt>
                      <dd className="text-sm font-semibold">{live.bore === "hex" ? "Hex" : "Round"}</dd>
                    </div>
                  )}
                </dl>
              )}
              {spec.loading && <p className="animate-pulse text-xs text-muted">The AI is still looking at the photo…</p>}
              <button
                type="button"
                className="btn-primary min-h-12 w-full active:scale-[0.98]"
                onClick={() => onNew({ category: cat?.id ?? null, specs, ...(r?.name ? { name: r.name, nameTouched: true } : {}) })}
              >
                Open with these specs →
              </button>
            </>
          )}
        </section>
      )}

      {shelf.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">On the shelf</h3>
          {shelf.map((m) => (
            <button key={m.id} type="button" className="press flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-raised/60 p-2 text-left active:scale-[0.98]" onClick={() => onOpenItem(m)}>
              {/* eslint-disable-next-line @next/next/no-img-element -- R2 thumbnails */}
              {m.thumbUrl ? <img src={m.thumbUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" /> : <span className="h-11 w-11 shrink-0 rounded-lg bg-line" />}
              <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
              <span className="shrink-0 text-sm tabular-nums text-muted">{`${formatStock(m.inStock, m.sheet)} ${m.sheet ? "sheets" : "in stock"}`}</span>
            </button>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Search results</h3>
        {(offers.value ?? []).map((o) => (
          <button key={normUrl(o.url)} type="button" className="press flex w-full items-start gap-3 rounded-xl border border-line bg-raised/60 p-2 text-left active:scale-[0.98]" onClick={() => onNew(fromOffer(o))}>
            {/* eslint-disable-next-line @next/next/no-img-element -- store photos from other sites */}
            {o.image ? <img src={o.image} alt="" className="h-16 w-16 shrink-0 rounded-lg bg-white object-contain" referrerPolicy="no-referrer" /> : <span className="h-16 w-16 shrink-0 rounded-lg bg-line" />}
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm font-medium">{o.title}</span>
              <span className="mt-0.5 block text-xs text-muted tabular-nums">
                {o.vendor}
                {o.price != null ? ` · $${o.price}` : ""}
              </span>
            </span>
          </button>
        ))}
        {offers.loading && <p className="animate-pulse text-sm text-muted">Searching the web…</p>}
        {!offers.loading && !(offers.value ?? []).length && <p className="text-sm text-muted">{offers.error ?? "Nothing found on the web."}</p>}
      </section>
    </div>
  );
}

// Store results (by the AI's product name) first, then the photo's web hits, each page once.
export function mergeOffers(stores: Offer[], web: Offer[]): Offer[] {
  const seen = new Set<string>();
  return [...stores, ...web].filter((o) => {
    const k = normUrl(o.url).replace(/\?.*$/, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
