"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useState, useTransition } from "react";
import {
  adjustStock,
  editItemPieces,
  countStock,
  deleteItem,
  itemPopup,
  linkItemToProduct,
  loadItemHistory,
  materialPopup,
  readProductLink,
  removeItemPhoto,
  setItemCondition,
  setItemLocation,
  setItemPhoto,
  setItemNote,
  setSeasonNeed,
  unlinkItemProduct,
} from "@/app/(app)/inventory/actions";
import { textOn } from "@/components/bom/options";
import { Dialog } from "@/components/Dialog";
import { Popover } from "@/components/bom/Popover";
import { useCan } from "@/components/shell/ModeContext";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import { materialCategory } from "@/config/materials";
import { activeFields, getCategory } from "@/lib/inventory/categories";
import { hasSeasonNeed, missing, orderHref } from "@/lib/inventory/season";
import type { PartChanges } from "@/lib/parts/changes";
import type { Offer, ProductGroup } from "@/lib/inventory/productGroups";
import { type PieceOp, applyPieceOp, countPieces, formatStock, isSheetGoods, parseStock, pieceBase, pieceLabel, pieceRows, snapStock, sortedRows, stepStock } from "@/lib/inventory/stock";
import { bestOffer, isLink, searchStores } from "./AddBox";
import { CartButton, CountBox, ItemPrice, NewSize, PieceStepper, conditionColor, hostOf } from "./ItemCard";
import { ItemForm, draftOf } from "./ItemForm";
import { CotsOrderBox, showsOrder, type CotsOrderInfo } from "./CotsOrderBox";
import { ItemHistory } from "./ItemHistory";
import { usePhotoPicker } from "./photo";
import { LocationPicker } from "./LocationPicker";
import { SeasonTag } from "./SeasonTag";
import { UsedIn } from "./UsedIn";
import { WorkshopMap } from "./WorkshopMap";
import type { Condition, InvCategory, Item, Location } from "./types";

// Anything connected to the inventory (a part card's material or inventory pill, a robot's
// inventory, an item card) opens this closable window instead of leaving the page (Harel,
// 2026-10-23). An item opens at once from what the page already has; the lists its pills need load
// behind it, and its history only when History is opened. The address gets ?item=<id>, so Back
// closes it and the link can be shared. − / + and the typed count show at once and save behind.

// A change shown in the window at once, and the save that follows it.
type ChangeItem = (change: (i: Item) => Partial<Item>, run: () => Promise<{ error?: string }>) => void;
type ItemData = NonNullable<Awaited<ReturnType<typeof itemPopup>>>;
type MaterialData = Awaited<ReturnType<typeof materialPopup>>;
// A COTS card opens its item with the card's order: the window shows Need to Order and the
// order status, and saves through the card (so the COTS page updates with it).
export type CotsOrderContext = { info: CotsOrderInfo; save: (changes: PartChanges) => void };
type State =
  | { kind: "item"; id: string; preview: Item | null; data: ItemData | null; order: CotsOrderContext | null }
  | { kind: "material"; name: string; data: MaterialData | null }
  | null;

const Ctx = createContext<{ openItem: (id: string, preview?: Item, opts?: { cotsOrder?: CotsOrderContext }) => void; openMaterial: (name: string) => void }>({
  openItem: () => {},
  openMaterial: () => {},
});
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
  const showItem = (id: string, preview: Item | null, order: CotsOrderContext | null = null) => {
    setError(null);
    setState({ kind: "item", id, preview, data: null, order });
    loadItem(id);
  };
  const openItem = (id: string, preview?: Item, opts?: { cotsOrder?: CotsOrderContext }) => {
    showItem(id, preview ?? null, opts?.cotsOrder ?? null);
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

  // Every control in the window shows its change at once (outside the transition, so React
  // paints it before the save answers) and saves behind it; only a failed save reloads.
  const patchItem = (itemId: string, change: (i: Item) => Partial<Item>) =>
    setState((s) => {
      const patch = <T extends Item>(i: T): T => (i.id === itemId ? { ...i, ...change(i) } : i);
      if (s?.kind === "material") return { ...s, data: s.data && { ...s.data, items: s.data.items.map(patch) } };
      if (s?.kind !== "item" || s.id !== itemId) return s;
      return { ...s, preview: s.preview && patch(s.preview), data: s.data && { ...s.data, item: patch(s.data.item) } };
    });
  const reload = () => {
    if (state?.kind === "item") loadItem(state.id);
    else if (state?.kind === "material") loadMaterial(state.name);
  };
  const after = (r: { error?: string }) => {
    if (r.error) setError(r.error);
    reload();
  };
  // Patch now, save in the background.
  const saveNow = (itemId: string, change: (i: Item) => Partial<Item>, run: () => Promise<{ error?: string }>) => {
    setError(null);
    patchItem(itemId, change);
    startTransition(async () => {
      const r = await run();
      if (r.error) after(r);
    });
  };
  const step = (itemId: string, delta: number, size?: string) => saveNow(itemId, (i) => stepStock(i, delta, size), () => adjustStock(itemId, delta, size));
  const count = (itemId: string, amount: number) => saveNow(itemId, (i) => countPieces(i, amount), () => countStock(itemId, amount));

  const item = state?.kind === "item" ? (state.data?.item ?? state.preview) : null;
  // An item without its own photo has no picture box, so its name anchors the window instead.
  const title =
    state?.kind === "item" ? (
      item && !item.thumbUrl ? (
        <span className="block text-2xl font-bold tracking-tight text-fg sm:text-3xl">{item.name}</span>
      ) : (
        (item?.name ?? "Inventory item")
      )
    ) : state?.kind === "material" ? (
      state.name
    ) : (
      ""
    );
  return (
    <Ctx.Provider value={{ openItem, openMaterial }}>
      {children}
      <Dialog open={!!state} onClose={close} title={title} width={state?.kind === "item" ? "w-[min(36rem,calc(100vw-2rem))]" : undefined} wide compact>
        {error && <p className="mb-3 rounded-md bg-rose-50 p-2 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}
        {state?.kind === "item" && !item && <p className="py-8 text-center text-sm text-muted">Loading…</p>}
        {state?.kind === "item" && item && (
          <ItemBody
            key={state.id}
            item={item}
            data={state.data}
            onStep={(d, b) => step(state.id, d, b)}
            onCount={(n) => count(state.id, n)}
            onSaved={() => after({})}
            onChange={(change, run) => saveNow(state.id, change, run)}
            onClose={close}
            // Only a window opened from the COTS page changes the order; anywhere else it's read-only.
            order={
              state.order ??
              (state.data?.order ? { info: { ...state.data.order, href: item.openOrder ? orderHref(item.openOrder) : undefined }, save: () => {} } : null)
            }
            orderEditable={!!state.order}
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

function Stepper({
  item,
  onStep,
  onCount,
  big = false,
  pieces = true,
  children,
}: {
  item: Pick<Item, "inStock" | "sheet" | "pieces" | "specs" | "name">;
  onStep: (d: number, size?: string) => void;
  onCount?: (n: number) => void;
  big?: boolean;
  pieces?: boolean; // the item window has Spread instead of pieces ▾
  children?: React.ReactNode;
}) {
  const work = useCan("work");
  const size = "h-10 w-10 text-xl";
  return (
    <div className="flex items-center gap-2">
      {work && (<button type="button" onClick={() => onStep(-1)} disabled={item.sheet ? item.inStock <= 0 : item.inStock < 1} className={`press flex ${size} items-center justify-center rounded-lg bg-rose-500 font-bold text-white hover:bg-rose-400 disabled:opacity-30`} aria-label="One less">
        −
      </button>)}
      <span className={`text-center font-mono font-semibold tabular-nums ${big ? "display min-w-10 text-2xl sm:text-3xl" : "min-w-14 text-xl"}`}>
        {onCount ? <CountBox item={item} onCount={onCount} big={big} /> : formatStock(item.inStock, item.sheet)}
      </span>
      {work && (<button type="button" onClick={() => onStep(1)} className={`press flex ${size} items-center justify-center rounded-lg bg-emerald-500 font-bold text-white hover:bg-emerald-400`} aria-label="One more">
        +
      </button>)}
      {item.sheet && pieces && (
        <span className="rounded-full bg-[#111318]/80 px-2 py-1 text-xs text-white">
          <PieceStepper item={item} onStep={onStep} />
        </span>
      )}
      {children}
    </div>
  );
}

// The item's note, like a part's Notes box: typed in place, saved when the box loses focus.
function ItemNotesBox({ item, onSaved, onError }: { item: Item; onSaved: () => void; onError: (m: string | null) => void }) {
  const [text, setText] = useState(item.note ?? "");
  const work = useCan("work");
  const [focused, setFocused] = useState(false);
  const [seen, setSeen] = useState(item.note);
  const [, start] = useTransition();
  // A note changed elsewhere (another member, Undo) shows here unless it's being typed in.
  if (seen !== item.note && !focused) {
    setSeen(item.note);
    setText(item.note ?? "");
  }
  return (
    <label className="block rounded-xl border-2 border-amber-400/70 bg-amber-50 px-3 py-2 shadow-[3px_4px_0_0_rgba(245,158,11,0.25)] focus-within:border-amber-500 dark:bg-amber-400/10">
      <span className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-amber-700 uppercase dark:text-amber-300">
        <Icon name="note" className="h-3.5 w-3.5" />
        Notes
      </span>
      <textarea
        value={text}
        rows={2}
        readOnly={!work}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (text.trim() === (item.note ?? "").trim()) return;
          const value = text;
          start(async () => {
            const r = await setItemNote(item.id, value);
            onError(r.error ?? null);
            if (!r.error) onSaved();
          });
        }}
        placeholder={work ? "Add a note for whoever takes or orders this…" : "No note"}
        className="mt-0.5 block w-full resize-y bg-transparent text-sm leading-snug font-semibold text-fg outline-none placeholder:font-normal placeholder:text-amber-700/50 dark:placeholder:text-amber-300/40"
      />
    </label>
  );
}

// "Season needs": how many the team wants on the shelf for the season, typed in place under
// the count. Blank or 0 clears it. Saves on Enter or when the box loses focus.
function SeasonBox({ item, onChange, onError }: { item: Item; onChange: ChangeItem; onError: (m: string | null) => void }) {
  const work = useCan("work");
  const current = hasSeasonNeed(item) ? formatStock(item.seasonNeed!, item.sheet) : "";
  const [text, setText] = useState<string | null>(null);
  // The new need shows at once ("Season needs 10 · 7 short"); the save follows.
  const save = () => {
    if (text === null || text.trim() === current) return setText(null);
    const value = text;
    const n = parseStock(value, item.sheet);
    setText(null);
    if (n === null) return onError(item.sheet ? 'Needed for season is a number or fraction, like "2" or "1 3/4".' : "Needed for season is a whole number.");
    onError(null);
    const seasonNeed = n > 0 ? snapStock(n, item.sheet) : null;
    onChange(() => ({ seasonNeed }), () => setSeasonNeed(item.id, value));
  };
  return (
    <label className="inline-flex items-center gap-2 rounded-xl border border-line bg-raised py-1 pr-1 pl-2.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
      <span className="text-[11px] leading-tight font-semibold text-subtle uppercase">Season needs</span>
      <input
        value={text ?? current}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setText(null);
        }}
        disabled={!work}
        inputMode={item.sheet ? "text" : "numeric"}
        placeholder="—"
        aria-label="Season needs"
        className="min-h-9 w-16 rounded-md border border-line-strong bg-surface px-1 py-1 text-center font-mono text-lg font-semibold tabular-nums outline-none focus:border-sky-400"
      />
    </label>
  );
}

// Spread: the item's piece sizes, biggest first. Each row is the real size and its share, − count +
// (tap the count to type it), ✏ to change the size and ✕ to remove it. A new length or plate size
// goes in at the bottom.
function SpreadPanel({ item, onOp }: { item: Item; onOp: (op: PieceOp) => void }) {
  const work = useCan("work");
  const [editing, setEditing] = useState<string | null>(null);
  const base = pieceBase(item.specs, item.name);
  const rows = sortedRows(pieceRows(item.inStock, item.pieces, base), base);
  return (
    <div className="w-full max-w-md rounded-lg border border-line bg-raised p-2">
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const label = pieceLabel(row.size, base);
          const icon = "press flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface hover:text-accent active:scale-[0.98]";
          return (
            <li key={row.size} className="flex items-center gap-2 py-1.5">
              {editing === row.size ? (
                <div className="min-w-0 flex-1">
                  <NewSize
                    base={base}
                    bare
                    label="Size"
                    onAdd={(to) => {
                      setEditing(null);
                      if (to !== row.size) onOp({ kind: "rename", size: row.size, to });
                    }}
                  />
                </div>
              ) : (
                <span className={`min-w-0 flex-1 truncate text-sm ${row.count > 0 ? "text-fg" : "text-subtle"}`}>
                  <span className="font-mono font-semibold tabular-nums">{label.primary}</span>
                  {label.sub && <span className="ml-1.5 rounded-full bg-surface px-1.5 py-0.5 font-mono text-[11px] text-muted tabular-nums">{label.sub}</span>}
                </span>
              )}
              {work && editing !== row.size && (
                <button type="button" onClick={() => onOp({ kind: "count", size: row.size, count: row.count - 1 })} disabled={row.count <= 0} className="press flex h-7 w-7 items-center justify-center rounded-md bg-rose-500 font-bold text-white hover:bg-rose-400 active:scale-[0.98] disabled:opacity-30" aria-label={`One less ${label.primary}`}>
                  −
                </button>
              )}
              {editing !== row.size && <PieceCount count={row.count} onCount={(c) => onOp({ kind: "count", size: row.size, count: c })} />}
              {work && editing !== row.size && (
                <button type="button" onClick={() => onOp({ kind: "count", size: row.size, count: row.count + 1 })} className="press flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500 font-bold text-white hover:bg-emerald-400 active:scale-[0.98]" aria-label={`One more ${label.primary}`}>
                  +
                </button>
              )}
              {work && base.kind !== "none" && (
                <button type="button" onClick={() => setEditing(editing === row.size ? null : row.size)} className={icon} aria-label={`Change size ${label.primary}`} title="Change the size">
                  <Icon name={editing === row.size ? "close" : "pencil"} className="h-3.5 w-3.5" />
                </button>
              )}
              {work && editing !== row.size && (
                <button
                  type="button"
                  onClick={() => (row.count === 0 || confirm(`Remove ${label.primary}? Its ${row.count} on the shelf come off the count.`)) && onOp({ kind: "remove", size: row.size })}
                  className={icon}
                  aria-label={`Remove size ${label.primary}`}
                  title="Remove this size"
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {work && <NewSize base={base} label={base.kind === "xy" ? "+ Size" : "+ Length"} onAdd={(size) => onOp({ kind: "add", size })} />}
    </div>
  );
}

// A Spread row's count: tap to type how many pieces of that size there are.
function PieceCount({ count, onCount }: { count: number; onCount: (n: number) => void }) {
  const work = useCan("work");
  const [text, setText] = useState<string | null>(null);
  const tone = count > 0 ? "text-accent" : "text-subtle";
  if (!work || text === null)
    return (
      <button type="button" disabled={!work} onClick={() => setText(String(count))} className={`w-10 text-center font-mono font-semibold tabular-nums ${tone} ${work ? "underline decoration-dotted underline-offset-4" : ""}`} aria-label="Type how many pieces">
        {count}
      </button>
    );
  const done = () => {
    const n = Number(text);
    if (Number.isInteger(n) && n >= 0 && n !== count) onCount(n);
    setText(null);
  };
  return (
    <input
      autoFocus
      value={text}
      inputMode="numeric"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") done();
        if (e.key === "Escape") setText(null);
      }}
      aria-label="Pieces of this size"
      className="w-10 rounded bg-white px-1 text-center font-mono text-fg tabular-nums outline-none"
    />
  );
}

// The item window, kept compact enough to open without scrolling: picture and tags, the count
// with Season needs beside it, the details, the parts that use it, then History and the pencil on
// one line. Condition and location save as they're picked; the pencil opens the full form (name,
// category, specs, and Delete for admins). The ⋯ menu holds the photo and the product link.
function ItemBody({
  item,
  data,
  onStep,
  onCount,
  onSaved,
  onChange,
  onClose,
  order,
  orderEditable,
}: {
  item: Item;
  data: ItemData | null;
  onStep: (d: number, size?: string) => void;
  onCount: (n: number) => void;
  onSaved: () => void;
  onChange: ChangeItem;
  onClose: () => void;
  order: CotsOrderContext | null;
  orderEditable: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [spreadOpen, setSpreadOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftOf(item));
  const [message, setMessage] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [, startPhoto] = useTransition();
  const work = useCan("work");
  const [, startMove] = useTransition();
  // A link's Unlink saves, then the window reloads.
  const save = (run: () => Promise<{ error?: string }>) =>
    startMove(async () => {
      const r = await run();
      setMessage(r.error ?? null);
      if (!r.error) onSaved();
    });
  const categories = data?.categories ?? [];
  const locations = data?.locations ?? [];
  const conditions = data?.conditions ?? [];
  const cat = getCategory(categories, item.category);
  const condition = conditions.find((c) => c.id === item.conditionId);
  const color = condition ? conditionColor(condition.color) : undefined;
  const location = locations.find((l) => l.id === item.locationId);
  const onMap = location?.mapX != null && location?.mapY != null;
  const [showMap, setShowMap] = useState(false);
  const usage = item.usage;
  // Only the item's own photo gets the picture box; the dimmed category drawing stays on the card.
  const picture = photo ?? item.thumbUrl ?? null;
  const onPhoto = (p: { key: string; preview: string }) =>
    startPhoto(async () => {
      setPhoto(p.preview);
      const r = await setItemPhoto(item.id, p.key);
      if (r.error) setMessage(r.error);
      else onSaved();
    });
  const picker = usePhotoPicker(onPhoto);
  const deletePhoto = () => {
    if (!confirm(`Delete the photo of "${item.name}"?`)) return;
    startPhoto(async () => {
      const r = await removeItemPhoto(item.id);
      setMessage(r.error ?? r.message ?? null);
      if (!r.error) {
        setPhoto(null);
        onChange(() => ({ thumbUrl: null }), async () => ({}));
        onSaved();
      }
    });
  };
  const unlink = (l: Item["cotsLinks"][number]) => {
    const last = item.cotsLinks.length === 1 && item.price != null;
    if (!confirm(`Remove the ${l.site || hostOf(l.url)} link from this item?${last ? " It's the last link, so the price goes too." : ""}`)) return;
    save(() => unlinkItemProduct(item.id, l.url));
  };
  const gap = missing(item, "any");
  const cart = (gap > 0 || item.openOrder) && <CartButton item={item} gap={gap} onLeave={onClose} onSent={onSaved} />;

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
        onDelete={() => {
          const warn = usage?.parts.length ? ` ${usage.parts.length} BOM parts will no longer draw from it.` : "";
          if (!confirm(`Delete "${item.name}" from the inventory?${warn}`)) return;
          return deleteItem(item.id).then(onClose);
        }}
      />
    );

  // Compact pills so all of them fit on one line under the picture on phones.
  const tag = "shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold max-sm:py-1";
  const caret = { backgroundPosition: "right 10px center, right 6px center", backgroundSize: "4px 4px", backgroundRepeat: "no-repeat" } as const;
  const caretOf = (c: string) => ({ ...caret, backgroundImage: `linear-gradient(45deg, transparent 50%, ${c} 50%), linear-gradient(135deg, ${c} 50%, transparent 50%)` });
  const specs = (cat ? activeFields(cat, item.specs) : []).filter((f) => item.specs[f.id]);
  // Where to buy it and the price, one line: on the picture, or with the tags when there's none.
  const buy = (item.cotsLinks.length > 0 || item.price != null) && (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#0D111A]/80 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md [&_button]:border-white/30 [&_button]:text-white/70">
      {item.cotsLinks.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="truncate hover:text-sky-300 hover:underline">
          {l.site || hostOf(l.url)}
        </a>
      ))}
      {item.price != null && <ItemPrice price={item.price} />}
    </span>
  );
  const menu = work && (
    <ItemMenu
      item={item}
      hasPhoto={!!picture}
      onTake={picker.takePhoto}
      onUpload={picker.upload}
      onDeletePhoto={deletePhoto}
      onUnlink={unlink}
      onMessage={setMessage}
      onLinked={(m) => {
        setMessage(m);
        onSaved();
      }}
    />
  );
  // On phones the right column dissolves into the outer row: the picture spans the top, the tags
  // sit on one line below it, and the count line and what follows take the whole width.
  const wide = "max-sm:w-full";
  return (
    <div className="space-y-2.5">
      {picker.inputs}
      <div className="flex flex-wrap gap-x-3 gap-y-2.5 sm:flex-nowrap">
        {picture && (
          <div className="thumb-well relative flex h-36 w-full shrink-0 items-center justify-center rounded-xl sm:h-44 sm:w-44">
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable */}
            <img src={picture} alt="" className={`h-full w-full object-contain p-2 ${picker.busy ? "opacity-50" : ""}`} />
            {cart && <div className="absolute top-1.5 left-1.5">{cart}</div>}
            {menu && <div className="absolute top-1.5 right-1.5">{menu}</div>}
            {picker.busy || picker.error ? (
              <span className={`absolute inset-x-2 bottom-2 rounded-md px-2 py-1 text-center text-xs font-semibold ${picker.error ? "bg-rose-600/90 text-white" : "bg-[#0D111A]/70 text-white"}`}>
                {picker.error ?? "Uploading…"}
              </span>
            ) : (
              buy && <div className="absolute right-2 bottom-2 left-2 flex">{buy}</div>
            )}
          </div>
        )}
        <div className="max-sm:contents sm:flex sm:min-w-0 sm:flex-1 sm:flex-col sm:gap-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-none">
            <div className="flex items-center gap-1.5 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:[scrollbar-width:none] sm:flex-wrap sm:gap-1">
              {cat && (
                <Link href={`/inventory/c/${cat.id}`} onClick={onClose} className={`${tag} bg-[#111318]/85 text-white hover:bg-accent`}>
                  {cat.label}
                </Link>
              )}
              <SeasonTag itemId={item.id} tag={item.seasonTag} className={tag} />
              {!picture && cart}
              {work && data ? (
                // Condition and location pills are menus that save at once.
                <>
                  <select
                    value={item.conditionId ?? ""}
                    onChange={(e) => {
                      const conditionId = e.target.value || null;
                      onChange(() => ({ conditionId }), () => setItemCondition(item.id, conditionId));
                    }}
                    aria-label="Condition"
                    className={`${tag} press cursor-pointer appearance-none border pr-6 disabled:opacity-60 ${condition ? "border-transparent hover:brightness-110" : "border-dashed border-line-strong bg-transparent text-muted hover:border-sky-400/40"}`}
                    style={condition ? { ...caretOf(textOn(color!)), backgroundColor: color, color: textOn(color!) } : caretOf("currentColor")}
                  >
                    <option value="" className="bg-surface text-fg">
                      {condition ? "No condition" : "Condition"}
                    </option>
                    {conditions.map((c) => (
                      <option key={c.id} value={c.id} className="bg-surface text-fg">
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <LocationPicker
                    locations={locations}
                    value={item.locationId}
                    onChange={(id) => onChange(() => ({ locationId: id }), () => setItemLocation(item.id, id))}
                    className={`${tag} press border bg-transparent hover:border-sky-400/40 active:scale-[0.98] disabled:opacity-60 ${location ? "border-line text-fg-2" : "border-dashed border-line-strong text-muted"}`}
                  >
                    {location ? `📍 ${location.name}` : "📍 Location"}
                  </LocationPicker>
                </>
              ) : (
                <>
                  {condition && (
                    <Link href={`/inventory/condition/${condition.id}`} onClick={onClose} className={`${tag} hover:brightness-110`} style={{ background: color, color: textOn(color!) }}>
                      {condition.label}
                    </Link>
                  )}
                  {location && (
                    <button
                      type="button"
                      onClick={() => setShowMap((v) => !v)}
                      aria-expanded={showMap}
                      title={onMap ? "Show where it is on the workshop map" : "Show the workshop map"}
                      className={`${tag} press border active:scale-[0.98] ${showMap ? "border-sky-400/60 bg-sky-500/15 text-sky-300" : "border-line text-fg-2 hover:border-sky-400/40 hover:text-accent"}`}
                    >
                      📍 {location.name}
                    </button>
                  )}
                </>
              )}
              {!picture && buy}
              {!picture && menu}
            </div>
            {(item.sheet || usage?.need || gap > 0) && (
              <div className="text-xs text-muted">
                {[item.sheet ? (isSheetGoods(cat?.label ?? item.name) ? "sheets on the shelf" : "on the shelf") : null, usage?.need ? `Robots need ${usage.need}` : null].filter(Boolean).join(" · ")}
                {gap > 0 && <span className="font-mono font-semibold text-rose-500 tabular-nums">{item.sheet || usage?.need ? " · " : ""}{gap} short</span>}
              </div>
            )}
          </div>
          {showMap && location && (
            // A compact map centred on the item's shelf, its pin lit in Orbit blue.
            <div className={`map-unfold w-full max-w-md space-y-1 ${wide}`}>
              <WorkshopMap key={location.id} locations={locations} focusId={location.id} selectedId={location.id} compact />
              <Link href={`/inventory?loc=${location.id}`} onClick={onClose} className="inline-block text-xs font-semibold text-accent hover:underline">
                {onMap ? `Everything at ${location.name} →` : `${location.name} isn't on the map yet. See everything there →`}
              </Link>
            </div>
          )}
          {/* The count and Season needs share one line. */}
          <div className={`flex flex-wrap items-center gap-2 ${wide}`}>
            <Stepper item={item} onStep={onStep} onCount={onCount} big pieces={false}>
              {item.sheet && (
                <button
                  type="button"
                  onClick={() => setSpreadOpen((o) => !o)}
                  aria-expanded={spreadOpen}
                  className={`press flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold active:scale-[0.98] ${spreadOpen ? "border-sky-400/60 bg-sky-500/15 text-accent" : "border-line text-fg-2 hover:border-sky-400/40 hover:text-accent"}`}
                >
                  Spread <Chevron open={spreadOpen} small />
                </button>
              )}
            </Stepper>
            <SeasonBox item={item} onChange={onChange} onError={setMessage} />
          </div>
          {item.sheet && spreadOpen && (
            <div className={wide}>
              <SpreadPanel item={item} onOp={(op) => onChange((i) => applyPieceOp(i, op), () => editItemPieces(item.id, op))} />
            </div>
          )}
          {order && showsOrder(order.info.status) && (
            <div className={wide}>
              <CotsOrderBox key={`${order.info.status}:${order.info.quantity}`} info={order.info} onSave={order.save} editable={orderEditable} onLeave={onClose} />
            </div>
          )}
        </div>
      </div>

      <ItemNotesBox item={item} onSaved={onSaved} onError={setMessage} />

      {specs.length > 0 && (
        <p className="text-sm leading-relaxed">
          {specs.map((f, i) => (
            <span key={f.id} className="inline">
              {i > 0 && <span className="mx-2 text-subtle" aria-hidden>·</span>}
              <span className="whitespace-nowrap">
                <span className="text-muted">{f.label}</span> <span className="font-semibold text-fg">{item.specs[f.id]}</span>
              </span>
            </span>
          ))}
        </p>
      )}

      {!!usage?.parts.length && <UsedIn usage={usage} sheet={item.sheet} />}

      {message && <p className="text-sm text-emerald-700">{message}</p>}
      {/* History and the pencil share the last line. */}
      <div className="flex items-start justify-between gap-2 border-t border-line pt-2">
        <div className="min-w-0 flex-1">
          <HistorySection item={item} categories={categories} locations={locations} conditions={conditions} />
        </div>
        {work && (
          <button
            type="button"
            className="btn mt-1 h-8 w-8 shrink-0 justify-center px-0 active:scale-[0.98]"
            disabled={!data}
            onClick={() => {
              setDraft(draftOf(item));
              setMode("edit");
            }}
            title="Edit item"
            aria-label="Edit item"
          >
            <Icon name="pencil" className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// The ⋯ menu: Take / Upload / Delete photo, and Edit link (search the stores or paste a link,
// right in the menu) with Unlink for each link the item has.
function ItemMenu({
  item,
  hasPhoto,
  onTake,
  onUpload,
  onDeletePhoto,
  onUnlink,
  onMessage,
  onLinked,
}: {
  item: Item;
  hasPhoto: boolean;
  onTake: () => void;
  onUpload: () => void;
  onDeletePhoto: () => void;
  onUnlink: (l: Item["cotsLinks"][number]) => void;
  onMessage: (m: string | null) => void;
  onLinked: (m: string | null) => void;
}) {
  const [linking, setLinking] = useState(false);
  return (
    <Popover
      align="right"
      hideCaret
      triggerClassName="press flex h-8 w-8 items-center justify-center rounded-full border border-white/40 bg-[#0D111A]/60 text-lg leading-none font-bold text-white shadow-sm backdrop-blur-md transition-colors duration-150 hover:border-sky-400/60 hover:text-sky-300 active:scale-[0.98]"
      trigger={
        <>
          ⋯<span className="sr-only">Photo and link options</span>
        </>
      }
    >
      {(close) => {
        const done = (run: () => void) => {
          setLinking(false);
          close();
          run();
        };
        if (linking)
          return (
            <div className="w-[min(22rem,calc(100vw-2rem))] p-1">
              <ProductSearch itemId={item.id} initial={item.name} onMessage={onMessage} onLinked={(m) => done(() => onLinked(m))} />
            </div>
          );
        const row = "press flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-medium text-fg hover:bg-raised active:scale-[0.98]";
        return (
          <div className="p-0.5">
            <button type="button" className={row} onClick={() => done(onTake)}>
              📷 Take photo
            </button>
            <button type="button" className={row} onClick={() => done(onUpload)}>
              <Icon name="download" className="h-4 w-4 rotate-180" /> Upload photo
            </button>
            {hasPhoto && (
              <button type="button" className={`${row} text-rose-500`} onClick={() => done(onDeletePhoto)}>
                <Icon name="close" className="h-4 w-4" /> Delete photo
              </button>
            )}
            <div className="my-0.5 border-t border-line" />
            <button type="button" className={row} onClick={() => setLinking(true)}>
              <Icon name="pencil" className="h-4 w-4" /> Edit link
            </button>
            {item.cotsLinks.map((l) => (
              <button key={l.url} type="button" className={`${row} text-rose-500`} onClick={() => done(() => onUnlink(l))}>
                <Icon name="close" className="h-4 w-4" /> Unlink {l.site || hostOf(l.url)}
              </button>
            ))}
          </div>
        );
      }}
    </Popover>
  );
}

// The item window's History, closed until opened; the first open loads it.
function HistorySection({ item, categories, locations, conditions }: { item: Item; categories: InvCategory[]; locations: Location[]; conditions: Condition[] }) {
  const [history, setHistory] = useState<Awaited<ReturnType<typeof loadItemHistory>> | null>(null);
  const [loading, startLoad] = useTransition();
  return (
    <details
      className="group"
      onToggle={(e) => {
        if (!e.currentTarget.open || history || loading) return;
        startLoad(async () => setHistory(await loadItemHistory(item.id)));
      }}
    >
      <summary className="label flex min-h-10 cursor-pointer list-none items-center gap-1.5 select-none hover:text-accent [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform duration-150 group-open:rotate-90">▸</span> History
      </summary>
      {history ? (
        <div className="max-h-56 overflow-y-auto">
          <ItemHistory history={history.history} orders={history.orders} sheet={item.sheet} categories={categories} locations={locations} conditions={conditions} />
        </div>
      ) : (
        <p className="text-sm text-muted">Loading…</p>
      )}
    </details>
  );
}

// Edit link in the ⋯ menu: search the team's stores (like the add box) or paste a
// product link; picking one links the item to it (link, price, photo) and the window reloads.
function ProductSearch({
  itemId,
  initial,
  onLinked,
  onMessage,
}: {
  itemId: string;
  initial: string;
  onLinked: (message: string | null) => void;
  onMessage: (m: string | null) => void;
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
    <div className="space-y-2 text-sm">
      <div className="px-1 text-[11px] font-semibold text-subtle">Link a product</div>
      <div className="flex gap-1.5">
        <label className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 focus-within:border-sky-400">
          <Icon name="search" className="h-4 w-4 shrink-0 text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && link && readLink()}
            autoFocus
            placeholder="Search stores or paste a link"
            aria-label="Link to a product"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none"
          />
        </label>
        {link && (
          <button type="button" className="btn-primary min-h-10" disabled={linking} onClick={readLink}>
            {linking ? "Linking…" : "Link"}
          </button>
        )}
      </div>
      {!query && (
        <button type="button" className="press block w-full truncate rounded-md px-1 text-left text-xs font-semibold text-accent hover:underline active:scale-[0.98]" onClick={() => setQ(initial)}>
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

function MaterialBody({ data, onStep, onOpen, onClose }: { data: MaterialData; onStep: (id: string, d: number, size?: string) => void; onOpen: (id: string) => void; onClose: () => void }) {
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
          <Stepper item={i} onStep={(d, b) => onStep(i.id, d, b)} />
        </li>
      ))}
    </ul>
  );
}
