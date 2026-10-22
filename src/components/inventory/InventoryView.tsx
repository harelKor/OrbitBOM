"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { getPartType } from "@/config/partTypes";
import { flattenTree, groupPath, subtreeIds } from "@/lib/inventory/groups";
import { adjustStock, deleteItem } from "@/app/(app)/inventory/actions";
import { textOn } from "@/components/bom/options";
import { Popover } from "@/components/bom/Popover";
import { EditOnly } from "@/components/shell/ModeContext";
import { SHEET_PIECES, formatStock, snapStock } from "@/lib/inventory/stock";
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
    state.map((i) => (i.id === id ? { ...i, inStock: snapStock(i.inStock + delta, i.sheet) } : i)),
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
        group === key ? "bg-accent/10 font-semibold text-accent" : "text-fg-2 hover:bg-raised"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="text-xs text-subtle">{count}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <EditOnly>
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
      </EditOnly>

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

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}

      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="panel h-fit shrink-0 p-2 lg:w-60">
          <div className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">Groups</div>
          {treeButton("all", "All items", items.length)}
          {treeButton("ungrouped", "Ungrouped", items.filter((i) => !i.groupId).length)}
          {tree.map(({ group: g, depth }) => treeButton(g.id, g.name, counts.get(g.id) ?? 0, depth))}
        </aside>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-sm text-muted">
            {shown.length === items.length ? `${items.length} items` : `${shown.length} of ${items.length} items`}
          </div>
          {items.length === 0 && (
            <div className="panel p-6 text-sm text-muted">
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
  const need = item.usage?.need ?? 0;
  const short = item.usage?.short ?? 0;

  return (
    // The item's condition marks the card's left edge.
    <div className="panel flex flex-col gap-2 border-l-4 p-3" style={condition ? { borderLeftColor: condition.color } : undefined}>
      <div className="min-w-0">
        <div className="font-semibold break-words">{item.name}</div>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
          {group && <span className="rounded border border-line-strong px-1.5 text-muted">▤ {group}</span>}
          {type && <span className="rounded border border-line-strong px-1.5 text-muted">{type.name}</span>}
          {condition && (
            <span className="rounded px-1.5" style={{ background: condition.color, color: textOn(condition.color) }}>
              {condition.label}
            </span>
          )}
          {location && <span className="rounded bg-raised px-1.5 text-fg-2">📍 {location}</span>}
          {item.material && <span className="rounded bg-raised px-1.5 text-fg-2">{item.material}</span>}
        </div>
        {spec && <div className="mt-1 text-xs text-muted">{spec}</div>}
        {(item.vendorName || item.vendorUrl || item.price != null) && (
          <div className="mt-1 text-xs text-muted">
            {item.vendorUrl ? (
              <a href={item.vendorUrl} target="_blank" rel="noreferrer" className="text-accent-soft hover:text-accent-soft">
                {item.vendorName || hostOf(item.vendorUrl)} ↗
              </a>
            ) : (
              item.vendorName
            )}
            {item.price != null && <span className="ml-2 text-emerald-700">${item.price.toFixed(2)}</span>}
          </div>
        )}
        {usedBy > 0 && (
          <details className="mt-1 text-xs">
            <summary className={`cursor-pointer ${short ? "text-amber-700" : "text-accent"}`}>
              Used by {usedBy} robot part{usedBy === 1 ? "" : "s"}
              {short > 0 && ` · ${short} short`}
            </summary>
            <ul className="mt-1 space-y-0.5 text-muted">
              {item.usage!.parts.map((p) => (
                <li key={p.partId} className="truncate">
                  {p.robotName} › {p.systemName} › <span className="text-fg">{p.partName}</span> ×{p.quantity}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-line pt-2 text-sm">
        <span className="text-muted">
          In stock <span className="font-mono font-semibold text-fg tabular-nums">{formatStock(item.inStock, item.sheet)}</span>
          {item.sheet && " sheets"}
        </span>
        {!item.sheet && need > 0 && (
          <span className={short ? "text-amber-700" : "text-muted"}>
            Need <span className="font-mono font-semibold tabular-nums">{need}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {item.sheet && <PieceStepper onStep={onStep} max={item.inStock} />}
          <button className="btn px-2 py-0.5" onClick={() => onStep(-1)} disabled={item.inStock < 1} aria-label={item.sheet ? "One sheet less" : "One less"}>
            −
          </button>
          <button className="btn px-2 py-0.5" onClick={() => onStep(1)} aria-label={item.sheet ? "One sheet more" : "One more"}>
            +
          </button>
        </div>
      </div>
      <EditOnly>
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
          <button className="btn text-rose-700 hover:text-rose-700" aria-label="Delete item">
            Delete
          </button>
        </form>
      </div>
      </EditOnly>
    </div>
  );
}

// A sheet item's pieces: add or take ¼ ⅓ ½ ⅔ ¾ of a sheet.
function PieceStepper({ onStep, max }: { onStep: (delta: number) => void; max: number }) {
  return (
    <Popover
      hideCaret
      align="right"
      triggerClassName="btn px-2 py-0.5 text-xs"
      trigger={<span>Piece ▾</span>}
    >
      {(close) => (
        <div className="space-y-1.5 p-1 text-sm">
          {(["add", "take"] as const).map((way) => (
            <div key={way} className="flex items-center gap-1">
              <span className="w-10 text-[11px] font-semibold text-subtle">{way === "add" ? "Add" : "Take"}</span>
              {SHEET_PIECES.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled={way === "take" && p.value > max + 1e-9}
                  onClick={() => {
                    onStep(way === "add" ? p.value : -p.value);
                    close();
                  }}
                  className={`press rounded-md px-2 py-1 font-semibold text-white disabled:opacity-30 ${way === "add" ? "bg-emerald-500 hover:bg-emerald-400" : "bg-rose-500 hover:bg-rose-400"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
