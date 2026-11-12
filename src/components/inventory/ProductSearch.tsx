"use client";

// The product search: search the team's stores (like the add box) or paste a product link.
// ProductPicker hands the chosen product (link, price, photo) to onChoose (Edit Item fills its
// draft with it); ProductSearch links an item to it straight away (Edit link in the item window's
// ⋮ menu, or the bottom of an unlinked item's window), and the window reloads.

import { useEffect, useState, useTransition } from "react";
import { linkItemToProduct, readProductLink } from "@/app/(app)/inventory/actions";
import { Icon } from "@/components/ui/Icon";
import type { Offer, ProductGroup } from "@/lib/inventory/productGroups";
import { bestOffer, isLink, searchStores } from "./AddBox";

export type ChosenProduct = { url: string; site?: string; price?: number | null; imageUrl?: string | null };

export function ProductSearch({
  itemId,
  initial,
  onLinked,
  onMessage,
  autoFocus = true,
}: {
  itemId: string;
  initial: string;
  autoFocus?: boolean;
  onLinked: (message: string | null) => void;
  onMessage: (m: string | null) => void;
}) {
  return (
    <ProductPicker
      title="Link a product"
      initial={initial}
      autoFocus={autoFocus}
      onChoose={async (p, note) => {
        const r = await linkItemToProduct(itemId, p);
        if (r.error) {
          onMessage(r.error);
          return false;
        }
        onLinked(note ? `Linked the product. ${note}` : (r.message ?? null));
        return true;
      }}
    />
  );
}

// onChoose returns false when the product wasn't taken (the search text stays). note is why a
// pasted page couldn't be read (the bare link is still handed over).
export function ProductPicker({
  initial,
  onChoose,
  title,
  autoFocus = true,
  actionLabel = "Link",
  placeholder = "Search stores or paste a link",
}: {
  initial: string;
  onChoose: (p: ChosenProduct, note?: string) => Promise<boolean> | boolean;
  title?: string;
  autoFocus?: boolean;
  actionLabel?: string;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; groups: ProductGroup[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [linking, startLink] = useTransition();
  const query = q.trim();
  const link = isLink(query);

  // Stores are asked only after a pause in typing.
  useEffect(() => {
    if (link || query.length < 3) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      setSearching(true);
      searchStores(query, c.signal)
        .then((r) => setFound({ q: query, groups: r.groups }))
        .catch(() => {})
        .finally(() => !c.signal.aborted && setSearching(false));
    }, 450);
    return () => {
      clearTimeout(t);
      c.abort();
      setSearching(false);
    };
  }, [link, query]);
  const groups = found?.q === query ? found.groups : null;

  const pick = (o: Pick<Offer, "url" | "vendor" | "price" | "image">) =>
    startLink(async () => {
      if (await onChoose({ url: o.url, site: o.vendor || undefined, price: o.price, imageUrl: o.image })) setQ("");
    });
  const readLink = () =>
    startLink(async () => {
      const r = await readProductLink(query);
      const p = r.product;
      if (await onChoose(p ? { url: p.url, site: p.site, price: p.price, imageUrl: p.image } : { url: query }, r.error)) setQ("");
    });

  return (
    <div className="space-y-2 text-sm">
      {title && <div className="px-1 text-[0.6875rem] font-semibold text-subtle">{title}</div>}
      <div className="flex gap-1.5">
        <label className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-raised px-3 focus-within:border-sky-400">
          <Icon name="search" className="h-4 w-4 shrink-0 text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (link && !linking) readLink();
            }}
            autoFocus={autoFocus}
            placeholder={placeholder}
            aria-label="Link to a product"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
          />
        </label>
        {link && (
          <button type="button" className="btn-primary min-h-10" disabled={linking} onClick={readLink}>
            {linking ? "Reading…" : actionLabel}
          </button>
        )}
      </div>
      {!query && initial.trim() && (
        <button type="button" className="press block w-full truncate rounded-lg border border-line-strong bg-raised px-3 py-2 text-left text-xs font-semibold text-accent hover:border-sky-400/40 active:scale-[0.98]" onClick={() => setQ(initial)}>
          Search “{initial}”
        </button>
      )}
      {!link && query.length >= 3 && (
        <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-line p-1">
          {!groups && <p className="px-2 py-2 text-xs text-muted">{searching ? "Searching the stores…" : "…"}</p>}
          {groups?.length === 0 && <p className="px-2 py-2 text-xs text-muted">No store result for that. Try other words, or paste a product link.</p>}
          {groups?.map((g) => (
            <div
              key={g.offers[0].url}
              role="button"
              tabIndex={0}
              aria-disabled={linking}
              onClick={() => !linking && pick({ ...bestOffer(g), image: bestOffer(g).image ?? g.image })}
              onKeyDown={(e) => e.key === "Enter" && !linking && pick({ ...bestOffer(g), image: bestOffer(g).image ?? g.image })}
              className="press flex cursor-pointer gap-3 rounded-lg p-2 hover:bg-raised active:scale-[0.98]"
            >
              <div className="thumb-well flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
                {g.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the store's own picture
                  <img src={g.image} alt="" className="h-full w-full rounded-lg bg-white object-contain" />
                ) : (
                  <Icon name="cart" className="h-5 w-5 text-subtle" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-fg" title={g.title}>
                  {g.title}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {g.offers.map((o) => (
                    <button
                      key={o.url}
                      type="button"
                      disabled={linking}
                      onClick={(e) => {
                        e.stopPropagation();
                        pick({ ...o, image: o.image ?? g.image });
                      }}
                      className="press min-h-8 rounded-full border border-line-strong px-2.5 text-xs font-semibold text-fg-2 hover:border-accent hover:text-accent"
                    >
                      {o.vendor}
                      {o.price != null && <span className="ml-1.5 font-mono text-emerald-600 tabular-nums">${o.price.toFixed(2)}</span>}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
