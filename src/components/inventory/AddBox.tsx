"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { findProducts, readProductLink, saveItem } from "@/app/(app)/inventory/actions";
import { Dialog } from "@/components/Dialog";
import { useCan } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { usePhone } from "@/components/ui/usePhone";
import { guessCategory } from "@/config/inventory";
import { buildName, getCategory } from "@/lib/inventory/categories";
import type { Offer, ProductGroup } from "@/lib/inventory/productGroups";
import { parseQuick } from "@/lib/inventory/quick";
import { formatStock } from "@/lib/inventory/stock";
import { useInventoryPopup } from "./InventoryPopup";
import { ItemForm, categoryLocation, emptyDraft, type Draft } from "./ItemForm";
import type { Condition, InvCategory, Item, Location } from "./types";

type Found = { q: string; groups: ProductGroup[]; elsewhere: { name: string; url: string }[] };

export const isLink = (s: string) => /^https?:\/\/\S+\.\S+/i.test(s.trim());

// The one box at the top of Inventory. In View mode it filters the shelf ("Do we have it?"). In
// Edit mode it also adds: as you type, items already on the shelf, products from the team's
// stores (the same product from several stores is one row, pick the store), smart typing
// ("36t htd 1/2 hex pulley"; when every word was understood, one click saves it, "Customize specs…"
// opens the form instead), else one "+ Create" for the typed name. Enter only confirms the search.
// A pasted product link is read from the page. The add form opens under the box and stays put for
// the next item; on phones the results take the whole width and the form is a bottom sheet.
export function AddBox({
  q,
  setQ,
  items,
  categories,
  locations,
  conditions,
  defaultCategory,
  defaultLocationId = null,
  placeholder,
  onPick,
  newStock = "1",
  floating = false,
  onAdded,
  onFocusChange,
}: {
  q: string;
  setQ: (q: string) => void;
  items: Item[];
  categories: InvCategory[];
  locations: Location[];
  conditions: Condition[];
  defaultCategory: string | null;
  defaultLocationId?: string | null;
  placeholder: string;
  onPick?: (itemId: string) => void; // a part's details window: an item picked or added links the part to it
  floating?: boolean; // the results float over the window the box is in (a part's details window), not inside it
  newStock?: string; // what a new item starts with in stock (the COTS page adds items still to buy: "0")
  onAdded?: (itemId: string) => void; // Inventory: a new item goes to the top of the list with a glow
  onFocusChange?: (focused: boolean) => void; // Inventory on phones: Scan shows only while the box is focused
}) {
  // Any team adds items; without a team it is only a search box.
  const edit = useCan("work");
  const { openItem } = useInventoryPopup();
  const [focus, setFocus] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [searching, startSearch] = useTransition();
  const [reading, startRead] = useTransition();
  const [readError, setReadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string; draft: Draft; message?: string } | null>(null);
  const [quickSaving, startQuickSave] = useTransition();
  const box = useRef<HTMLInputElement>(null);
  const phone = usePhone();
  const focusChanged = useRef(onFocusChange);
  useEffect(() => {
    focusChanged.current = onFocusChange;
  });
  useEffect(() => focusChanged.current?.(focus), [focus]);

  const query = q.trim();
  const link = isLink(query);
  const quick = !link && query ? parseQuick(query, categories) : null;
  const quickCat = getCategory(categories, quick?.categoryId);
  const quickName = quickCat && quick && Object.keys(quick.specs).length ? buildName(quickCat, quick.specs) : "";
  const quickWhole = !!quickName && quick!.left.length === 0;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const onShelf = query && !link ? items.filter((i) => words.every((w) => `${i.name} ${Object.values(i.specs).join(" ")}`.toLowerCase().includes(w))).slice(0, 4) : [];

  // Stores are asked only after a pause in typing, never while the page renders.
  useEffect(() => {
    if (!edit || link || query.length < 3 || draft) return;
    const t = setTimeout(() => startSearch(async () => setFound({ q: query, ...(await findProducts(query)) })), 450);
    return () => clearTimeout(t);
  }, [edit, link, query, draft]);
  const products = found?.q === query ? found : null;

  const start = (over: Partial<Draft>) => {
    const cat = getCategory(categories, over.category ?? null);
    setDraft(emptyDraft({ inStock: newStock, locationId: defaultLocationId ?? categoryLocation(cat, items), locationTouched: !!defaultLocationId, ...over }));
    setSaved(null);
    setFocus(false);
  };
  const fromOffer = (group: ProductGroup, offer: Offer) => {
    const parsed = parseQuick(offer.title, categories);
    const category = parsed?.categoryId ?? guessCategory(offer.title, categories.map((c) => c.id)) ?? defaultCategory;
    start({ category, specs: parsed?.specs ?? {}, name: offer.title, nameTouched: true, links: [{ url: offer.url, site: offer.vendor }], price: offer.price, imageUrl: offer.image ?? group.image });
  };
  const readLink = () =>
    startRead(async () => {
      setReadError(null);
      const r = await readProductLink(query);
      if (r.product) {
        const p = r.product;
        fromOffer({ title: p.title, image: p.image, offers: [] }, { vendor: p.site, url: p.url, title: p.title, image: p.image, price: p.price });
      } else {
        setReadError(r.error ?? null);
        start({ category: defaultCategory, links: [{ url: query }] });
      }
    });
  // The whole line was understood: save it as it is, 1 in stock, on the category's shelf.
  const quickSave = () =>
    startQuickSave(async () => {
      const draft = emptyDraft({ category: quickCat!.id, specs: quick!.specs, locationId: defaultLocationId ?? categoryLocation(quickCat, items) });
      const r = await saveItem(null, { name: quickName, category: draft.category, specs: draft.specs, inStock: newStock, conditionId: null, locationId: draft.locationId, links: [], price: null, imageUrl: null });
      if (r.error || !r.id) return setReadError(r.error ?? "Couldn't save.");
      if (onPick) {
        onPick(r.id);
        return setQ("");
      }
      setSaved({ id: r.id, name: quickName, draft, message: r.message });
      onAdded?.(r.id);
      setQ("");
    });
  // The add form with what was typed and what it understood; else the page's category.
  const custom = (categoryId: string) =>
    start(Object.keys(quick!.specs).length ? { category: categoryId, specs: quick!.specs } : { category: categoryId, name: query, nameTouched: !!query });
  const createNew = () => (quick ? custom(quick.categoryId) : start({ category: defaultCategory, name: query, nameTouched: true }));

  const open = edit && focus && !!query && !draft;

  // Floating results: fixed in the window's top layer, under the box (or over it when there's
  // more room above), as wide as useful and as tall as the screen allows. On phones the results
  // always float, the whole width of the screen under the box (on Inventory the box shares its
  // row with Scan and Map, Harel 2026-10-29), over a dimmed page that closes them when tapped.
  const label = useRef<HTMLLabelElement>(null);
  const floats = floating || phone;
  const [float, setFloat] = useState<{ host: Element; style: React.CSSProperties } | null>(null);
  useLayoutEffect(() => {
    if (!floats || !open) return;
    const place = () => {
      const el = label.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      // The keyboard covers the bottom of a phone's screen.
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const width = phone ? vw - 24 : Math.min(Math.max(r.width, 448), vw - 16);
      const left = phone ? 12 : Math.min(Math.max(8, r.right - width), vw - width - 8);
      const below = vh - r.bottom - 14;
      const up = !phone && below < 280 && r.top > below;
      const style: React.CSSProperties = up
        ? { left, width, bottom: vh - r.top + 6, maxHeight: r.top - 14 }
        : { left, width, top: r.bottom + 6, maxHeight: Math.max(below, 200) };
      setFloat({ host: el.closest("dialog") ?? document.body, style });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [floats, open, phone]);

  const results = (
    <>
      {link && (
        <Row onClick={readLink} icon="download" title={reading ? "Reading the page…" : "Read this product link"} detail="Name, price and photo from the store's page" />
      )}
      {quickName && (
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <Row
              onClick={() => (quickWhole ? quickSave() : custom(quick!.categoryId))}
              icon="spark"
              title={quickSaving ? "Adding…" : `Add “${quickName}”`}
              detail={quickWhole ? `${quickCat!.label} · adds it, ${newStock} in stock` : `${quickCat!.label} · finish the details`}
            />
          </div>
          {quickWhole && (
            <button
              type="button"
              onClick={() => custom(quick!.categoryId)}
              className="press min-h-10 shrink-0 rounded-full border border-line-strong px-3 text-xs font-semibold text-fg-2 transition-colors duration-150 hover:border-sky-400/40 hover:text-accent active:scale-[0.98]"
            >
              Customize specs…
            </button>
          )}
        </div>
      )}

      {onShelf.length > 0 && (
        <Section title={onPick ? "On the shelf · click to link" : "Already on the shelf"}>
          {onShelf.map((i) => (
            <Row key={i.id} onClick={() => (onPick ? onPick(i.id) : openItem(i.id, i))} img={i.thumbUrl} icon="box" title={i.name} detail={`${formatStock(i.inStock, i.sheet)} ${i.sheet ? "sheets" : "in stock"}`} />
          ))}
        </Section>
      )}

      {/* One way to create: the understood line above, else the typed name. */}
      {!link && !quickName && (
        <button
          type="button"
          onClick={createNew}
          className="press flex min-h-11 w-full items-center gap-2 rounded-xl border border-dashed border-sky-400/50 bg-sky-500/5 px-3 text-left text-sm font-semibold text-sky-600 transition-colors duration-150 hover:border-sky-400 hover:bg-sky-500/10 active:scale-[0.98] dark:text-sky-400"
        >
          <span aria-hidden className="text-base leading-none">+</span>
          <span className="min-w-0 truncate">Create “{query}” as new item</span>
        </button>
      )}

      {!link && query.length >= 3 && (
        <Section title={searching && !products ? "Products · searching the stores…" : "Products"}>
          {products?.groups.length === 0 && <p className="px-2 text-xs text-muted">No store result for that. Try other words, or paste a product link.</p>}
          {products?.groups.map((g) => (
            // The whole row picks the product (the cheapest store with a price); a store button picks that store.
            <div
              key={g.offers[0].url}
              role="button"
              tabIndex={0}
              onClick={() => fromOffer(g, bestOffer(g))}
              onKeyDown={(e) => e.key === "Enter" && fromOffer(g, bestOffer(g))}
              className="press flex cursor-pointer gap-3 rounded-xl p-2 hover:bg-raised"
            >
              <div className="thumb-well flex h-14 w-14 shrink-0 items-center justify-center rounded-lg">
                {g.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the store's own picture
                  <img src={g.image} alt="" className="h-full w-full rounded-lg bg-white object-contain" />
                ) : (
                  <Icon name="cart" className="h-6 w-6 text-subtle" />
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
                      onClick={(e) => {
                        e.stopPropagation();
                        fromOffer(g, o);
                      }} className="press min-h-9 rounded-full border border-line-strong px-3 text-xs font-semibold text-fg-2 hover:border-accent hover:text-accent" title={o.title}>
                      {o.vendor}
                      {o.price != null && <span className="ml-1.5 font-mono text-emerald-600 tabular-nums">${o.price.toFixed(2)}</span>}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {products && (
            <p className="px-2 pt-1 text-xs text-muted">
              Also look on{" "}
              {products.elsewhere.map((e, i) => (
                <span key={e.name}>
                  {i > 0 && ", "}
                  <a href={e.url} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">
                    {e.name} ↗
                  </a>
                </span>
              ))}{" "}
              and paste the product link here.
            </p>
          )}
        </Section>
      )}
    </>
  );
  const addedBanner = saved && (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300 ${phone ? "" : "mt-2"}`}>
      <span className="min-w-0 flex-1">
        Added <span className="font-semibold">{saved.name}</span>.{saved.message && ` ${saved.message}`}
      </span>
      <button
        type="button"
        className="btn min-h-10 active:scale-[0.98]"
        onClick={() => {
          if (phone) setSaved(null);
          openItem(saved.id);
        }}
      >
        Edit
      </button>
      <button type="button" className="btn min-h-10 active:scale-[0.98]" onClick={() => setDraft({ ...saved.draft, inStock: "1", links: [], imageUrl: null, price: null, photo: null })}>
        Add another like this
      </button>
      {phone ? (
        <button type="button" className="btn-primary min-h-10 w-full active:scale-[0.98]" onClick={() => start({ category: saved.draft.category, locationId: saved.draft.locationId, locationTouched: true })}>
          + Add a different item
        </button>
      ) : (
        <button type="button" className="press text-emerald-700" aria-label="Dismiss" onClick={() => setSaved(null)}>
          <Icon name="close" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
  const form = draft && (
    <ItemForm
      itemId={null}
      draft={draft}
      setDraft={setDraft}
      categories={categories}
      locations={locations}
      conditions={conditions}
      items={items}
      onCancel={() => setDraft(null)}
      onSaved={(id, message) => {
        if (onPick) {
          onPick(id);
          setDraft(null);
          return setQ("");
        }
        const cat = getCategory(categories, draft.category);
        const name = draft.nameTouched || !cat ? draft.name : buildName(cat, draft.specs) || draft.name;
        setSaved({ id, name, draft, message });
        onAdded?.(id);
        setDraft(null);
        setQ("");
      }}
    />
  );
  const panel = "space-y-3 overflow-y-auto rounded-2xl border border-line-strong bg-surface p-3 shadow-[0_16px_40px_-12px_rgba(17,19,24,0.35)]";
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-2xl">
      <label ref={label} className="relative block">
        <Icon name={edit ? "box" : "search"} className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-subtle" />
        <input
          ref={box}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setReadError(null);
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            // A pasted link is read; anything else is a search: Enter keeps the filter and
            // closes the results (Harel, 2026-10-28). "+ Create" in the results adds it.
            if (edit && link) return readLink();
            setFocus(false);
            box.current?.blur();
          }}
          placeholder={onPick ? placeholder : edit ? "Add an item: type a name or paste a link" : placeholder}
          className="input min-h-12 py-3 pr-10 pl-11 text-base"
          aria-label={edit ? "Add or find an item" : "Search the inventory"}
        />
        {q && (
          <button type="button" onClick={() => setQ("")} className="press absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-subtle hover:text-fg" aria-label="Clear">
            <Icon name="close" className="h-4 w-4" />
          </button>
        )}
      </label>
      {edit && !query && !draft && !saved && (
        <button type="button" onClick={() => start({ category: defaultCategory })} className="mt-2 text-sm font-medium text-accent hover:underline">
          + Add without searching
        </button>
      )}

      {open &&
        (floats
          ? float &&
            createPortal(
              <>
                {phone && float.style.top != null && (
                  // Tapping the dimmed page blurs the box, which closes the results.
                  <div aria-hidden style={{ top: float.style.top }} className="modal-backdrop fixed inset-x-0 bottom-0 z-[59]" />
                )}
                <div style={float.style} className={`fixed z-[60] ${panel}`} onMouseDown={(e) => e.preventDefault()}>
                  {results}
                </div>
              </>,
              float.host,
            )
          : (
            <div className={`absolute top-full right-0 left-0 z-40 mt-1.5 max-h-[70vh] ${panel}`} onMouseDown={(e) => e.preventDefault()}>
              {results}
            </div>
          ))}

      {readError && <p className="mt-2 text-sm text-amber-700">{readError}</p>}
      {phone ? (
        // On phones the form is a sheet from the bottom, the whole width, its Add button always
        // in view; after adding it stays open to add the next one.
        <Dialog open={!!draft || !!saved} onClose={() => (setDraft(null), setSaved(null))} title={draft ? "Add an item" : "Added"} sheet>
          {saved && !draft ? addedBanner : form}
        </Dialog>
      ) : (
        <>
          {saved && !draft && addedBanner}
          {draft && <div className="panel mt-3 p-4">{form}</div>}
        </>
      )}
    </div>
  );
}

export const bestOffer = (g: ProductGroup) => g.offers.filter((o) => o.price != null).sort((a, b) => a.price! - b.price!)[0] ?? g.offers[0];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({ onClick, icon, img, title, detail }: { onClick: () => void; icon: "box" | "download" | "spark"; img?: string | null; title: string; detail: string }) {
  return (
    <button type="button" onClick={onClick} className="press flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-raised">
      <span className="thumb-well flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
          <img src={img} alt="" className="h-full w-full object-contain p-0.5" />
        ) : (
          <Icon name={icon} className="h-5 w-5 text-accent" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg">{title}</span>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
    </button>
  );
}
