"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { getPartType } from "@/config/partTypes";
import { flattenTree, groupPath, subtreeIds } from "@/lib/inventory/groups";
import { adjustStock, deleteItem } from "@/app/(app)/inventory/actions";
import { textOn } from "@/components/bom/options";
import { ConditionsDialog, GroupsDialog, LocationsDialog, PartTypesDialog } from "./ListDialogs";
import { ImportDialog } from "./ImportDialog";
import { ItemDialog } from "./ItemDialog";
import { ToBomDialog } from "./ToBomDialog";
import type { BomTarget, Item, Lookups } from "./types";

type Open =
  | { kind: "item"; item: Item | null }
  | { kind: "toBom"; item: Item }
  | { kind: "groups" | "types" | "conditions" | "locations" | "import" }
  | null;

// The Inventory page body (ref §5): groups tree, toolbar, filters and item cards.
export function InventoryView({ items, targets, ...lookups }: Lookups & { items: Item[]; targets: BomTarget[] }) {
  const { groups, conditions, locations } = lookups;
  const [open, setOpen] = useState<Open>(null);
  const [group, setGroup] = useState<"all" | "ungrouped" | string>("all");
  const [q, setQ] = useState("");
  const [conditionId, setConditionId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [optimistic, addOptimistic] = useOptimistic(items, (state, { id, delta }: { id: string; delta: number }) =>
    state.map((i) => (i.id === id ? { ...i, inStock: Math.max(0, i.inStock + delta) } : i)),
  );
  const [, startTransition] = useTransition();
  const step = (id: string, delta: number) =>
    startTransition(async () => {
      setError(null);
      addOptimistic({ id, delta });
      const result = await adjustStock(id, delta);
      if (result.error) setError(result.error);
    });

  // An item without its own location takes its group's.
  const locationOf = (i: Item) => i.locationId ?? groups.find((g) => g.id === i.groupId)?.locationId ?? null;

  const tree = useMemo(() => flattenTree(groups), [groups]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const g of groups) {
      const ids = subtreeIds(groups, g.id);
      c.set(g.id, items.filter((i) => i.groupId && ids.has(i.groupId)).length);
    }
    return c;
  }, [groups, items]);

  const shown = optimistic.filter((i) => {
    if (group === "ungrouped" && i.groupId) return false;
    if (group !== "all" && group !== "ungrouped" && !(i.groupId && subtreeIds(groups, group).has(i.groupId)))
      return false;
    if (q.trim() && !i.name.toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (conditionId && i.conditionId !== conditionId) return false;
    if (locationId && locationOf(i) !== locationId) return false;
    return true;
  });

  const treeButton = (key: string, label: React.ReactNode, count: number, depth = 0) => (
    <button
      key={key}
      onClick={() => setGroup(key)}
      style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
      className={`flex w-full items-center justify-between gap-2 rounded-md py-1 pr-2 text-left text-sm ${
        group === key ? "bg-indigo-500/20 text-indigo-200" : "text-slate-300 hover:bg-slate-800"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="text-xs text-slate-500">{count}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <button className="btn" onClick={() => setOpen({ kind: "groups" })}>
          Groups
        </button>
        <button className="btn" onClick={() => setOpen({ kind: "types" })}>
          Part types
        </button>
        <button className="btn" onClick={() => setOpen({ kind: "conditions" })}>
          Conditions
        </button>
        <button className="btn" onClick={() => setOpen({ kind: "locations" })}>
          Locations
        </button>
        <button className="btn" onClick={() => setOpen({ kind: "import" })}>
          Import spreadsheet
        </button>
        <button className="btn-primary ml-auto" onClick={() => setOpen({ kind: "item", item: null })}>
          + Add inventory item
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter inventory by name…"
          className="input max-w-sm flex-1"
        />
        <select value={conditionId} onChange={(e) => setConditionId(e.target.value)} className="input w-auto">
          <option value="">Any condition</option>
          {conditions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input w-auto">
          <option value="">Any location</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="rounded-md bg-rose-950 p-3 text-sm text-rose-200">Couldn&apos;t save: {error}</p>}

      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="panel h-fit shrink-0 p-2 lg:w-60">
          <div className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Groups</div>
          {treeButton("all", "All items", items.length)}
          {treeButton("ungrouped", "Ungrouped", items.filter((i) => !i.groupId).length)}
          {tree.map(({ group: g, depth }) => treeButton(g.id, g.name, counts.get(g.id) ?? 0, depth))}
        </aside>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-sm text-slate-400">
            {shown.length === items.length ? `${items.length} items` : `${shown.length} of ${items.length} items`}
          </div>
          {items.length === 0 && (
            <div className="panel p-6 text-sm text-slate-400">
              No inventory yet. Add items one by one, or import the spreadsheet you already keep.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {shown.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                group={groupPath(groups, item.groupId)}
                condition={conditions.find((c) => c.id === item.conditionId)}
                location={locations.find((l) => l.id === locationOf(item))?.name}
                onStep={(d) => step(item.id, d)}
                onEdit={() => setOpen({ kind: "item", item })}
                onToBom={() => setOpen({ kind: "toBom", item })}
              />
            ))}
          </div>
        </div>
      </div>

      <ItemDialog
        key={open?.kind === "item" ? (open.item?.id ?? "new") : "closed"}
        open={open?.kind === "item"}
        item={open?.kind === "item" ? open.item : null}
        defaultGroupId={group !== "all" && group !== "ungrouped" ? group : null}
        lookups={lookups}
        onClose={() => setOpen(null)}
      />
      <ToBomDialog
        key={open?.kind === "toBom" ? open.item.id : "closed-bom"}
        item={open?.kind === "toBom" ? open.item : null}
        targets={targets}
        onClose={() => setOpen(null)}
      />
      <GroupsDialog open={open?.kind === "groups"} lookups={lookups} onClose={() => setOpen(null)} />
      <PartTypesDialog open={open?.kind === "types"} onClose={() => setOpen(null)} />
      <ConditionsDialog open={open?.kind === "conditions"} conditions={conditions} onClose={() => setOpen(null)} />
      <LocationsDialog open={open?.kind === "locations"} locations={locations} onClose={() => setOpen(null)} />
      <ImportDialog open={open?.kind === "import"} onClose={() => setOpen(null)} />
    </div>
  );
}

function ItemCard({
  item,
  group,
  condition,
  location,
  onStep,
  onEdit,
  onToBom,
}: {
  item: Item;
  group: string;
  condition?: { label: string; color: string };
  location?: string;
  onStep: (delta: number) => void;
  onEdit: () => void;
  onToBom: () => void;
}) {
  const type = item.templateId ? getPartType(item.templateId) : undefined;
  const spec = (type?.fields ?? [])
    .filter((f) => item.templateValues[f.id])
    .map((f) => `${f.label} ${item.templateValues[f.id]}`)
    .join(" · ");
  const usedBy = item.usage?.parts.length ?? 0;
  const used = item.usage?.used ?? 0;
  const short = item.usage?.robots.some((r) => r.needed > item.inStock);

  return (
    <div className="panel flex flex-col gap-2 p-3">
      <div className="min-w-0">
        <div className="font-semibold break-words">{item.name}</div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
          {group && <span className="rounded border border-slate-700 px-1.5 text-slate-400">▤ {group}</span>}
          {type && <span className="rounded border border-slate-700 px-1.5 text-slate-400">{type.name}</span>}
          {condition && (
            <span className="rounded px-1.5" style={{ background: condition.color, color: textOn(condition.color) }}>
              {condition.label}
            </span>
          )}
          {location && <span className="rounded bg-slate-800 px-1.5 text-slate-300">📍 {location}</span>}
          {item.material && <span className="rounded bg-slate-800 px-1.5 text-slate-300">{item.material}</span>}
        </div>
        {spec && <div className="mt-1 text-xs text-slate-400">{spec}</div>}
        {(item.vendorName || item.vendorUrl || item.price != null) && (
          <div className="mt-1 text-xs text-slate-400">
            {item.vendorUrl ? (
              <a href={item.vendorUrl} target="_blank" rel="noreferrer" className="text-indigo-300 hover:text-indigo-200">
                {item.vendorName || hostOf(item.vendorUrl)} ↗
              </a>
            ) : (
              item.vendorName
            )}
            {item.price != null && <span className="ml-2 text-emerald-300">${item.price.toFixed(2)}</span>}
          </div>
        )}
        {usedBy > 0 && (
          <details className="mt-1 text-xs">
            <summary className={`cursor-pointer ${short ? "text-amber-300" : "text-sky-300"}`}>
              Used by {usedBy} robot part{usedBy === 1 ? "" : "s"}
              {short && " · not enough in stock"}
            </summary>
            <ul className="mt-1 space-y-0.5 text-slate-400">
              {item.usage!.parts.map((p) => (
                <li key={p.partId} className="truncate">
                  {p.robotName} › {p.systemName} › <span className="text-slate-200">{p.partName}</span> ×{p.quantity}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-slate-800 pt-2 text-sm">
        <span className="text-slate-400">
          In stock <span className="font-semibold text-slate-100">{item.inStock}</span>
        </span>
        <span className="text-slate-400">
          Used <span className="font-semibold text-slate-100">{used}</span>
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn px-2 py-0.5" onClick={() => onStep(-1)} disabled={item.inStock === 0} aria-label="One less">
            −
          </button>
          <button className="btn px-2 py-0.5" onClick={() => onStep(1)} aria-label="One more">
            +
          </button>
        </div>
      </div>
      <div className="flex gap-2 text-sm">
        <button className="btn" onClick={onToBom}>
          To BOM
        </button>
        <button className="btn" onClick={onEdit}>
          Edit
        </button>
        <form
          action={deleteItem.bind(null, item.id)}
          onSubmit={(e) => {
            const warn = usedBy ? ` ${usedBy} BOM parts will no longer draw from it.` : "";
            if (!confirm(`Delete "${item.name}" from the inventory?${warn}`)) e.preventDefault();
          }}
          className="ml-auto"
        >
          <button className="btn text-rose-300 hover:text-rose-200" aria-label="Delete item">
            Delete
          </button>
        </form>
      </div>
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
