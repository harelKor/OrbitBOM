"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useTransition } from "react";
import { adjustStock, itemPopup, materialPopup } from "@/app/(app)/inventory/actions";
import { Dialog } from "@/components/Dialog";
import { Icon } from "@/components/ui/Icon";
import { materialCategory } from "@/config/materials";
import { getCategory, specLine } from "@/lib/inventory/categories";
import { formatStock } from "@/lib/inventory/stock";
import { PieceStepper, ProductName } from "./ItemCard";
import type { InvCategory, Item, Location } from "./types";

// Anything connected to the inventory (a part card's material or inventory pill, a robot's
// inventory, an item card) opens this closable window instead of leaving the page (Harel,
// 2026-10-23). It loads what it shows when it opens; − / + work in place.

type ItemData = NonNullable<Awaited<ReturnType<typeof itemPopup>>>;
type MaterialData = Awaited<ReturnType<typeof materialPopup>>;
type State = { kind: "item"; id: string; data: ItemData | null } | { kind: "material"; name: string; data: MaterialData | null } | null;

const Ctx = createContext<{ openItem: (id: string) => void; openMaterial: (name: string) => void }>({ openItem: () => {}, openMaterial: () => {} });
export const useInventoryPopup = () => useContext(Ctx);

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
  const openItem = (id: string) => {
    setError(null);
    setState({ kind: "item", id, data: null });
    loadItem(id);
  };
  const openMaterial = (name: string) => {
    setError(null);
    setState({ kind: "material", name, data: null });
    loadMaterial(name);
  };
  const step = (itemId: string, delta: number) =>
    startTransition(async () => {
      const r = await adjustStock(itemId, delta);
      if (r.error) setError(r.error);
      if (state?.kind === "item") loadItem(state.id);
      else if (state?.kind === "material") loadMaterial(state.name);
      router.refresh();
    });

  const title = state?.kind === "item" ? (state.data?.item.name ?? "Inventory item") : state?.kind === "material" ? state.name : "";
  return (
    <Ctx.Provider value={{ openItem, openMaterial }}>
      {children}
      <Dialog open={!!state} onClose={() => setState(null)} title={title} wide>
        {error && <p className="mb-3 rounded-md bg-rose-50 p-2 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}
        {state && !state.data && <p className="py-8 text-center text-sm text-muted">Loading…</p>}
        {state?.kind === "item" && state.data && <ItemBody data={state.data} onStep={(d) => step(state.id, d)} onClose={() => setState(null)} />}
        {state?.kind === "material" && state.data && (
          <MaterialBody data={state.data} onStep={step} onOpen={openItem} onClose={() => setState(null)} />
        )}
      </Dialog>
    </Ctx.Provider>
  );
}

function Stepper({ item, onStep, big = false }: { item: Pick<Item, "inStock" | "sheet">; onStep: (d: number) => void; big?: boolean }) {
  const size = big ? "h-12 w-12 text-2xl" : "h-10 w-10 text-xl";
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => onStep(-1)} disabled={item.inStock < 1} className={`press flex ${size} items-center justify-center rounded-lg bg-rose-500 font-bold text-white hover:bg-rose-400 disabled:opacity-30`} aria-label="One less">
        −
      </button>
      <span className={`min-w-14 text-center font-mono font-semibold tabular-nums ${big ? "display text-4xl" : "text-xl"}`}>{formatStock(item.inStock, item.sheet)}</span>
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

function ItemBody({ data, onStep, onClose }: { data: ItemData; onStep: (d: number) => void; onClose: () => void }) {
  const { item, categories, locations } = data;
  const cat = getCategory(categories, item.category);
  const spec = specLine(cat, item.specs);
  const location = locations.find((l) => l.id === item.locationId)?.name;
  const usage = item.usage;
  return (
    <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="thumb-well flex aspect-square items-center justify-center rounded-xl">
        {item.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
          <img src={item.thumbUrl} alt="" className="h-full w-full object-contain p-3" />
        ) : (
          <Icon name="box" className="h-12 w-12 text-subtle" />
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <div>
          <ProductName item={item} className="text-lg font-semibold" />
          <div className="text-xs text-muted">
            {cat?.label}
            {spec && <span className="font-mono tabular-nums"> · {spec}</span>}
            {location && <> · 📍 {location}</>}
          </div>
        </div>
        <Stepper item={item} onStep={onStep} big />
        <div className="text-xs text-muted">
          {item.sheet ? "sheets on the shelf" : usage?.need ? `Robots need ${usage.need}` : "No robot part uses it yet"}
          {!!usage?.short && <span className="font-semibold text-amber-600"> · {usage.short} short</span>}
          {item.price != null && <span className="font-mono text-emerald-600 tabular-nums"> · ${item.price.toFixed(2)} each</span>}
        </div>
        {!!usage?.parts.length && (
          <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-lg border border-line text-sm">
            {usage.parts.map((p) => {
              const covered = usage.coveredOf.get(p.partId) ?? 0;
              return (
                <li key={p.partId} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted">
                      {p.robotName} › {p.systemName} ›{" "}
                    </span>
                    {p.partName}
                  </span>
                  {!item.sheet && <span className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${covered < p.quantity ? "text-amber-600" : "text-emerald-600"}`}>{covered}/{p.quantity}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <Link href={`/inventory/item/${item.id}`} onClick={onClose} className="inline-block text-sm font-medium text-accent hover:underline">
          Open the item page (history, matches) →
        </Link>
      </div>
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
