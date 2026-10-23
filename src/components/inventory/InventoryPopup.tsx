"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, useTransition } from "react";
import { adjustStock, countStock, deleteItem, itemPopup, materialPopup } from "@/app/(app)/inventory/actions";
import { textOn } from "@/components/bom/options";
import { Dialog } from "@/components/Dialog";
import { EditOnly } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { materialCategory } from "@/config/materials";
import { getCategory } from "@/lib/inventory/categories";
import { formatStock, snapStock } from "@/lib/inventory/stock";
import { CountBox, PieceStepper, conditionColor, hostOf } from "./ItemCard";
import { ItemForm, draftOf } from "./ItemForm";
import { ItemHistory } from "./ItemHistory";
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
  window.history[push ? "pushState" : "replaceState"](window.history.state, "", url);
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
        <div className="thumb-well flex h-28 w-28 shrink-0 items-center justify-center rounded-xl sm:h-36 sm:w-36">
          {picture ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
            <img src={picture} alt="" className="h-full w-full object-contain p-2" />
          ) : (
            <Icon name="box" className="h-12 w-12 text-subtle" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-1">
            {cat && (
              <Link href={`/inventory/c/${cat.id}`} onClick={onClose} className={`${tag} bg-[#111318]/85 text-white hover:bg-accent`}>
                {cat.label}
              </Link>
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
            {item.sheet ? "sheets on the shelf · tap the number to type the count" : usage?.need ? `Robots need ${usage.need} · tap the number to type the count` : "Tap the number to type the count"}
            {!!usage?.short && <span className="font-semibold text-amber-600"> · {usage.short} short</span>}
          </div>
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
              <dd className="font-mono text-emerald-600 tabular-nums">${item.price.toFixed(2)} each</dd>
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
                    href={p.systemId ? `/robots/${p.robotId}/systems/${p.systemId}#part-${p.partId}` : `/robots/${p.robotId}`}
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
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
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
        </div>
      </EditOnly>

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
