"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, useTransition } from "react";
import {
  adjustStock,
  countStock,
  deleteItem,
  findBomParts,
  findProducts,
  itemPopup,
  linkItemToProduct,
  materialPopup,
  readProductLink,
  setItemCategory,
  setItemPhoto,
  setSeasonNeed,
} from "@/app/(app)/inventory/actions";
import { textOn } from "@/components/bom/options";
import { Dialog } from "@/components/Dialog";
import { EditOnly, useEditMode } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { materialCategory } from "@/config/materials";
import { getCategory } from "@/lib/inventory/categories";
import { hasSeasonNeed, missing } from "@/lib/inventory/season";
import type { Offer, ProductGroup } from "@/lib/inventory/productGroups";
import { formatStock, snapStock } from "@/lib/inventory/stock";
import { bestOffer, isLink } from "./AddBox";
import { CountBox, ItemPrice, PieceStepper, conditionColor, hostOf } from "./ItemCard";
import { ItemForm, draftOf } from "./ItemForm";
import { ItemHistory } from "./ItemHistory";
import { PhotoButtons } from "./photo";
import { ToBomDialog } from "./ToBomDialog";
import type { InvCategory, Item, Location } from "./types";

// Anything connected to the inventory (a part card's material or inventory pill, a robot's
// inventory, an item card) opens this closable window instead of leaving the page (Harel,
// 2026-10-23). An item opens at once from what the page already has; its history and the rest
// load behind it. The address gets ?item=<id>, so Back closes it and the link can be shared.
// − / + and the typed count work in place.

type ItemData = NonNullable<Awaited<ReturnType<typeof itemPopup>>>;
type MaterialData = Awaited<ReturnType<typeof materialPopup>>;
type State = { kind: "item"; id: string; preview: Item | null; data: ItemData | null } | { kind: "material"; name: string; data: MaterialData | null } | null;

const Ctx = createContext<{ openItem: (id: string, preview?: Item) => void; openMaterial: (name: string) => void }>({ openItem: () => {}, openMaterial: () => {} });
export const useInventoryPopup = () => useContext(Ctx);

const ITEM_PARAM = "item";
const urlItem = () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(ITEM_PARAM));
function setUrlItem(id: string | null, push: boolean) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(ITEM_PARAM, id);
  else url.searchParams.delete(ITEM_PARAM);
  // Plain history calls: Next picks the change up, so a refresh keeps ?item in the address.
  window.history[push ? "pushState" : "replaceState"](null, "", url);
}

export function InventoryPopupProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<State>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const loadItem = (id: string) =>
    startTransition(async () => {
      const data = await itemPopup(id);
      setState((s) => (s?.kind === "item" && s.id === id ? { ...s, data } : s));
    });
  const loadMaterial = (name: string) =>
    startTransition(async () => {
      const data = await materialPopup(name);
      setState((s) => (s?.kind === "material" && s.name === name ? { ...s, data } : s));
    });
  const showItem = (id: string, preview: Item | null) => {
    setError(null);
    setState({ kind: "item", id, preview, data: null });
    loadItem(id);
  };
  const openItem = (id: string, preview?: Item) => {
    showItem(id, preview ?? null);
    if (urlItem() !== id) setUrlItem(id, true);
  };
  const openMaterial = (name: string) => {
    setError(null);
    setState({ kind: "material", name, data: null });
    loadMaterial(name);
  };
  const close = () => {
    setState(null);
    if (urlItem()) setUrlItem(null, false);
  };

  // A shared link opens its item; Back and Forward open or close the window.
  useEffect(() => {
    const sync = () => {
      const id = urlItem();
      if (id) showItem(id, null);
      else setState((s) => (s?.kind === "item" ? null : s));
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  // Show the new count at once, then reload.
  const bump = (itemId: string, to: (n: number) => number) =>
    setState((s) => {
      if (s?.kind !== "item" || s.id !== itemId) return s;
      const patch = <T extends Pick<Item, "inStock" | "sheet">>(i: T): T => ({ ...i, inStock: snapStock(to(i.inStock), i.sheet) });
      return { ...s, preview: s.preview && patch(s.preview), data: s.data && { ...s.data, item: patch(s.data.item) } };
    });
  const after = (r: { error?: string }) => {
    if (r.error) setError(r.error);
    if (state?.kind === "item") loadItem(state.id);
    else if (state?.kind === "material") loadMaterial(state.name);
    router.refresh();
  };
  const step = (itemId: string, delta: number) =>
    startTransition(async () => {
      bump(itemId, (n) => n + delta);
      after(await adjustStock(itemId, delta));
    });
  const count = (itemId: string, amount: number) =>
    startTransition(async () => {
      bump(itemId, () => amount);
      after(await countStock(itemId, amount));
    });

  const item = state?.kind === "item" ? (state.data?.item ?? state.preview) : null;
  const title = state?.kind === "item" ? (item?.name ?? "Inventory item") : state?.kind === "material" ? state.name : "";
  return (
    <Ctx.Provider value={{ openItem, openMaterial }}>
      {children}
      <Dialog open={!!state} onClose={close} title={title} width={state?.kind === "item" ? "w-[min(36rem,calc(100vw-1rem))]" : undefined} wide>
        {error && <p className="mb-3 rounded-md bg-rose-50 p-2 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}
        {state?.kind === "item" && !item && <p className="py-8 text-center text-sm text-muted">Loading…</p>}
        {state?.kind === "item" && item && (
          <ItemBody
            key={state.id}
            item={item}
            data={state.data}
            onStep={(d) => step(state.id, d)}
            onCount={(n) => count(state.id, n)}
            onSaved={() => after({})}
            onClose={close}
          />
        )}
        {state?.kind === "material" && !state.data && <p className="py-8 text-center text-sm text-muted">Loading…</p>}
        {state?.kind === "material" && state.data && (
          <MaterialBody data={state.data} onStep={step} onOpen={(id) => openItem(id, state.data?.items.find((i) => i.id === id))} onClose={close} />
        )}
      </Dialog>
    </Ctx.Provider>
  );
}

function Stepper({ item, onStep, onCount, big = false }: { item: Pick<Item, "inStock" | "sheet">; onStep: (d: number) => void; onCount?: (n: number) => void; big?: boolean }) {
  const size = big ? "h-12 w-12 text-2xl" : "h-10 w-10 text-xl";
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => onStep(-1)} disabled={item.inStock < 1} className={`press flex ${size} items-center justify-center rounded-lg bg-rose-500 font-bold text-white hover:bg-rose-400 disabled:opacity-30`} aria-label="One less">
        −
      </button>
      <span className={`min-w-14 text-center font-mono font-semibold tabular-nums ${big ? "display text-4xl" : "text-xl"}`}>
        {onCount ? <CountBox item={item} onCount={onCount} big={big} /> : formatStock(item.inStock, item.sheet)}
      </span>
      <button type="button" onClick={() => onStep(1)} className={`press flex ${size} items-center justify-center rounded-lg bg-emerald-500 font-bold text-white hover:bg-emerald-400`} aria-label="One more">
        +
      </button>
      {item.sheet && (
        <span className="rounded-full bg-[#111318]/80 px-2 py-1 text-xs text-white">
          <PieceStepper onStep={onStep} max={item.inStock} />
        </span>
      )}
    </div>
  );
}

// "Needed for Season": how many the team wants on the shelf for the season, typed in place under
// the count. Blank or 0 clears it. Saves on Enter or when the box loses focus.
function SeasonBox({ item, onSaved, onError }: { item: Item; onSaved: () => void; onError: (m: string | null) => void }) {
  const current = hasSeasonNeed(item) ? formatStock(item.seasonNeed!, item.sheet) : "";
  const [text, setText] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () => {
    if (text === null || text.trim() === current) return setText(null);
    const value = text;
    start(async () => {
      const r = await setSeasonNeed(item.id, value);
      onError(r.error ?? null);
      setText(null);
      if (!r.error) onSaved();
    });
  };
  return (
    <label className="inline-flex items-center gap-2.5 rounded-xl border border-line bg-raised py-1.5 pr-1.5 pl-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
      <span className="text-[11px] leading-tight font-semibold text-subtle uppercase">Needed for Season</span>
      <input
        value={text ?? current}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setText(null);
        }}
        disabled={pending}
        inputMode={item.sheet ? "text" : "numeric"}
        placeholder="—"
        aria-label="Needed for Season"
        className="w-20 rounded-md border border-line-strong bg-surface px-1 py-1 text-center font-mono text-lg font-semibold tabular-nums outline-none focus:border-sky-400"
      />
    </label>
  );
}

// The item window: picture and tags (each opens its page), the count, the details, the parts
// that use it, Edit / To BOM / Delete in Edit mode, and the history.
function ItemBody({
  item,
  data,
  onStep,
  onCount,
  onSaved,
  onClose,
}: {
  item: Item;
  data: ItemData | null;
  onStep: (d: number) => void;
  onCount: (n: number) => void;
  onSaved: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "toBom">("view");
  const [draft, setDraft] = useState(() => draftOf(item));
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const [finding, startFind] = useTransition();
  const [photo, setPhoto] = useState<string | null>(null);
  const [, startPhoto] = useTransition();
  const edit = useEditMode();
  const [moving, startMove] = useTransition();
  const moveTo = (categoryId: string) =>
    startMove(async () => {
      const r = await setItemCategory(item.id, categoryId);
      setMessage(r.error ?? null);
      if (!r.error) onSaved();
    });
  const find = () =>
    startFind(async () => {
      const r = await findBomParts(item.id);
      setMessage(r.error ?? r.message ?? null);
    });
  const categories = data?.categories ?? [];
  const locations = data?.locations ?? [];
  const conditions = data?.conditions ?? [];
  const cat = getCategory(categories, item.category);
  const condition = conditions.find((c) => c.id === item.conditionId);
  const color = condition ? conditionColor(condition.color) : undefined;
  const location = locations.find((l) => l.id === item.locationId);
  const usage = item.usage;
  const picture = item.thumbUrl ?? cat?.imageUrl ?? null;

  if (mode === "edit" && data)
    return (
      <ItemForm
        itemId={item.id}
        draft={draft}
        setDraft={setDraft}
        categories={categories}
        locations={locations}
        conditions={conditions}
        items={[]}
        onCancel={() => setMode("view")}
        onSaved={(_, m) => {
          setMode("view");
          setMessage(m ?? "Saved.");
          onSaved();
        }}
      />
    );

  const tag = "rounded-full px-2.5 py-0.5 text-xs font-semibold";
  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="shrink-0 space-y-1.5">
          <div className="thumb-well flex h-44 w-44 items-center justify-center rounded-xl sm:h-56 sm:w-56">
            {photo || picture ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
              <img src={photo ?? picture!} alt="" className="h-full w-full object-contain p-2" />
            ) : (
              <Icon name="box" className="h-12 w-12 text-subtle" />
            )}
          </div>
          <EditOnly>
            <PhotoButtons
              compact
              onPhoto={(p) =>
                startPhoto(async () => {
                  setPhoto(p.preview);
                  const r = await setItemPhoto(item.id, p.key);
                  if (r.error) setMessage(r.error);
                  else onSaved();
                })
              }
            />
          </EditOnly>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-1">
            {edit && data ? (
              // Edit mode: the pill moves the item to another category at once.
              <select
                value={item.category ?? ""}
                disabled={moving}
                onChange={(e) => e.target.value && moveTo(e.target.value)}
                aria-label="Category"
                className={`${tag} press cursor-pointer appearance-none border border-transparent bg-[#111318]/85 pr-6 text-white hover:border-sky-400/40 disabled:opacity-60`}
                style={{ backgroundImage: "linear-gradient(45deg, transparent 50%, #fff 50%), linear-gradient(135deg, #fff 50%, transparent 50%)", backgroundPosition: "right 10px center, right 6px center", backgroundSize: "4px 4px", backgroundRepeat: "no-repeat" }}
              >
                {!cat && <option value="">No category</option>}
                {categories.map((c) => (
                  <option key={c.id} value={c.id} className="bg-surface text-fg">
                    {c.label}
                  </option>
                ))}
              </select>
            ) : (
              cat && (
                <Link href={`/inventory/c/${cat.id}`} onClick={onClose} className={`${tag} bg-[#111318]/85 text-white hover:bg-accent`}>
                  {cat.label}
                </Link>
              )
            )}
            {condition && (
              <Link href={`/inventory/condition/${condition.id}`} onClick={onClose} className={`${tag} hover:brightness-110`} style={{ background: color, color: textOn(color!) }}>
                {condition.label}
              </Link>
            )}
            {location && (
              <Link href={`/inventory/location/${location.id}`} onClick={onClose} className={`${tag} border border-line text-fg-2 hover:border-accent hover:text-accent`}>
                📍 {location.name}
              </Link>
            )}
          </div>
          <Stepper item={item} onStep={onStep} onCount={onCount} big />
          <div className="text-xs text-muted">
            {[
              item.sheet ? "sheets on the shelf" : null,
              hasSeasonNeed(item) ? `Season needs ${formatStock(item.seasonNeed!, item.sheet)}` : null,
              usage?.need ? `Robots need ${usage.need}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Tap the number to type the count"}
            {missing(item, "any") > 0 && <span className="font-mono font-semibold text-rose-500 tabular-nums"> · {missing(item, "any")} short</span>}
          </div>
          <SeasonBox item={item} onSaved={onSaved} onError={setMessage} />
        </div>
      </div>

      {(cat?.fields.some((f) => item.specs[f.id]) || item.cotsLinks.length > 0 || item.price != null) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {(cat?.fields ?? [])
            .filter((f) => item.specs[f.id])
            .map((f) => (
              <div key={f.id} className="contents">
                <dt className="text-muted">{f.label}</dt>
                <dd>{item.specs[f.id]}</dd>
              </div>
            ))}
          {item.cotsLinks.length > 0 && (
            <>
              <dt className="text-muted">Buy at</dt>
              <dd className="flex flex-wrap gap-x-3">
                {item.cotsLinks.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline dark:text-sky-400">
                    {l.site || hostOf(l.url)} ↗
                  </a>
                ))}
              </dd>
            </>
          )}
          {item.price != null && (
            <>
              <dt className="text-muted">Price</dt>
              <dd className="flex items-center gap-1.5">
                <ItemPrice price={item.price} suffix=" each" />
              </dd>
            </>
          )}
        </dl>
      )}

      {!!usage?.parts.length && (
        <div>
          <div className="label">Used in</div>
          <ul className="max-h-40 divide-y divide-line overflow-y-auto rounded-lg border border-line text-sm">
            {usage.parts.map((p) => {
              const covered = usage.coveredOf.get(p.partId) ?? 0;
              return (
                <li key={p.partId}>
                  <Link
                    href={p.systemId ? `/robots/${p.robotId}/systems/${p.systemId}#part-${p.partId}` : p.robotId ? `/robots/${p.robotId}` : "/cots/released"}
                    onClick={onClose}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-raised"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-muted">
                        {p.robotName} › {p.systemName} ›{" "}
                      </span>
                      {p.partName}
                    </span>
                    {!item.sheet && (
                      <span className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${covered < p.quantity ? "text-amber-600" : "text-emerald-600"}`}>
                        {covered}/{p.quantity}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {message && <p className="text-sm text-emerald-700">{message}</p>}
      <EditOnly>
        <ProductSearch
          itemId={item.id}
          initial={item.name}
          onMessage={setMessage}
          onLinked={(m) => {
            setMessage(m);
            onSaved();
          }}
        />
      </EditOnly>
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <button className="btn min-h-11" disabled={finding} onClick={find} title="Look for BOM parts that are this item; each one waits in To Review for Approve">
          <Icon name="search" className="h-4 w-4" /> {finding ? "Looking…" : "Find BOM parts"}
        </button>
        <EditOnly>
          <button
            className="btn min-h-11"
            disabled={!data}
            onClick={() => {
              setDraft(draftOf(item));
              setMode("edit");
            }}
          >
            <Icon name="pencil" className="h-4 w-4" /> Edit
          </button>
          <button className="btn min-h-11" disabled={!data} onClick={() => setMode("toBom")}>
            To BOM
          </button>
          <button
            className="btn ml-auto min-h-11 text-rose-700"
            disabled={deleting}
            onClick={() => {
              const warn = usage?.parts.length ? ` ${usage.parts.length} BOM parts will no longer draw from it.` : "";
              if (!confirm(`Delete "${item.name}" from the inventory?${warn}`)) return;
              startDelete(async () => {
                await deleteItem(item.id);
                onClose();
                router.refresh();
              });
            }}
          >
            Delete
          </button>
        </EditOnly>
      </div>

      <div>
        <div className="label">History</div>
        {data ? (
          <div className="max-h-56 overflow-y-auto">
            <ItemHistory history={data.history} sheet={item.sheet} categories={categories} locations={locations} conditions={conditions} />
          </div>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </div>
      {data && <ToBomDialog key={mode === "toBom" ? "bom" : "closed-bom"} item={mode === "toBom" ? item : null} targets={data.targets} onClose={() => setMode("view")} />}
    </div>
  );
}

// The item window's product bar: search the team's stores (like the add box) or paste a product
// link; picking one links the item to it (link, price, photo) and the window reloads.
function ProductSearch({ itemId, initial, onLinked, onMessage }: { itemId: string; initial: string; onLinked: (message: string | null) => void; onMessage: (m: string | null) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; groups: ProductGroup[] } | null>(null);
  const [searching, startSearch] = useTransition();
  const [linking, startLink] = useTransition();
  const query = q.trim();
  const link = isLink(query);

  // Stores are asked only after a pause in typing.
  useEffect(() => {
    if (link || query.length < 3) return;
    const t = setTimeout(() => startSearch(async () => setFound({ q: query, groups: (await findProducts(query)).groups })), 450);
    return () => clearTimeout(t);
  }, [link, query]);
  const groups = found?.q === query ? found.groups : null;

  const pick = (o: Pick<Offer, "url" | "vendor" | "price" | "image">) =>
    startLink(async () => {
      const r = await linkItemToProduct(itemId, { url: o.url, site: o.vendor || undefined, price: o.price, imageUrl: o.image });
      if (r.error) return onMessage(r.error);
      setQ("");
      onLinked(r.message ?? null);
    });
  const readLink = () =>
    startLink(async () => {
      const r = await readProductLink(query);
      const p = r.product;
      const res = await linkItemToProduct(itemId, p ? { url: p.url, site: p.site, price: p.price, imageUrl: p.image } : { url: query });
      if (res.error) return onMessage(res.error);
      setQ("");
      onLinked(r.error ? `Linked the product. ${r.error}` : (res.message ?? null));
    });

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <label className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-line-strong bg-surface px-3 focus-within:border-sky-400">
          <Icon name="search" className="h-4 w-4 shrink-0 text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && link && readLink()}
            placeholder="Link to a product: search the stores or paste a link"
            aria-label="Link to a product"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
          />
        </label>
        {!query && (
          <button type="button" className="btn min-h-11" onClick={() => setQ(initial)}>
            Search “{initial.length > 18 ? `${initial.slice(0, 18)}…` : initial}”
          </button>
        )}
        {link && (
          <button type="button" className="btn-primary min-h-11" disabled={linking} onClick={readLink}>
            {linking ? "Linking…" : "Link"}
          </button>
        )}
      </div>
      {!link && query.length >= 3 && (
        <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-xl border border-line p-1">
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

function MaterialBody({ data, onStep, onOpen, onClose }: { data: MaterialData; onStep: (id: string, d: number) => void; onOpen: (id: string) => void; onClose: () => void }) {
  const { items, categories, locations } = data;
  const group = materialCategory(data.material);
  const home = categories.find((c: InvCategory) => c.fields.some((f) => f.kind === "material" && group && f.materials?.includes(group)));
  if (!items.length)
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted">None of this material is on the shelf.</p>
        <Link href={home ? `/inventory/c/${home.id}` : "/inventory"} onClick={onClose} className="btn-primary min-h-11">
          Add it in {home?.label ?? "Inventory"}
        </Link>
      </div>
    );
  return (
    <ul className="space-y-2">
      {items.map((i: Item) => (
        <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-2">
          <button type="button" onClick={() => onOpen(i.id)} className="press thumb-well flex h-14 w-14 shrink-0 items-center justify-center rounded-lg">
            {i.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
              <img src={i.thumbUrl} alt="" className="h-full w-full object-contain p-1" />
            ) : (
              <Icon name="box" className="h-6 w-6 text-subtle" />
            )}
          </button>
          <button type="button" onClick={() => onOpen(i.id)} className="min-w-0 flex-1 text-left">
            <div className="truncate font-semibold hover:text-accent">{i.name}</div>
            <div className="text-xs text-muted">
              {getCategory(categories, i.category)?.label}
              {locations.find((l: Location) => l.id === i.locationId) && <> · 📍 {locations.find((l: Location) => l.id === i.locationId)!.name}</>}
            </div>
          </button>
          <Stepper item={i} onStep={(d) => onStep(i.id, d)} />
        </li>
      ))}
    </ul>
  );
}
