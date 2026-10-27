"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { COTS_IN_STOCK, COTS_ORDERED, COTS_RELEASED, IN_STOCK_SHOWN_DAYS, ORDER_STATUSES, getCotsStatus } from "@/config/cots";
import { CATEGORY_GROUPS, groupOf, isCategoryGroup, type CategoryGroupId } from "@/config/inventory";
import { addCotsFromItem, clearInStock, updateCotsParts } from "@/app/(app)/cots/actions";
import { BomProvider, useBom } from "@/components/bom/BomContext";
import { PartStage, type StageView } from "@/components/dashboard/PartStage";
import { AddBox } from "@/components/inventory/AddBox";
import type { Condition, InvCategory, Item, Location } from "@/components/inventory/types";
import { useEditMode } from "@/components/shell/ModeContext";
import { statusTint } from "@/components/ui/statusTint";
import { StatusField } from "@/components/bom/fields";
import { Thumb } from "@/components/bom/Thumb";
import { ownerPartId, partTitle, type CardPart } from "@/components/bom/types";
import { CategoryBoxes, pushQuery } from "@/components/ui/CategoryBoxes";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { cotsTotal, groupSameCots, siteOf, spreadCotsChanges } from "@/lib/cots";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";
import { CotsCard, OrderStatusButton } from "./CotsCard";
import { formatPrice, useCurrency } from "./currency";

// robotId null: the General section (a card added on the COTS page for no robot).
export type CotsViewPart = CardPart & { robotId: string | null; robotName: string | null; cotsInStockAt: Date | null; cotsClearedAt: Date | null; category: string };
// The shelf, for Released's search box.
export type CotsShelf = { items: Item[]; categories: InvCategory[]; locations: Location[]; conditions: Condition[] };
type Edit = { id: string; changes: PartChanges };
// One card: a part, or the same part from several systems (members) shown with the total amount.
type Row = { key: string; part: CardPart; members: CardPart[] };
// Dragging cards between Released's robot sections and its In order list section.
const DRAG_TYPE = "application/x-orbit-cots";
type DragLoad = { ids: string[]; from: "list" | "ordered" };
type Place = { robotId: string | null; name: string };

const groupLabel = (id: CategoryGroupId) => CATEGORY_GROUPS.find((g) => g.id === id)!.label;
// Where a Released card came from: a robot's BOM (or a robot's section), or General.
const originOf = (p: CardPart): "General" | "Robot" => (p.systemId || (p as CotsViewPart).robotId ? "Robot" : "General");
const ORDERING = ORDER_STATUSES.filter((s) => s !== COTS_IN_STOCK) as string[];
const SHOWN_MS = IN_STOCK_SHOWN_DAYS * 24 * 60 * 60 * 1000;
const NO_VENDOR = "No vendor";
const vendorOf = (p: CardPart) => (p.cotsLinks?.[0] ? siteOf(p.cotsLinks[0]) : NO_VENDOR);

function shelfOf(members: CardPart[]) {
  const first = members.find((m) => m.shelf)?.shelf;
  if (!first) return null;
  const same = members.filter((m) => m.shelf?.itemId === first.itemId);
  return { ...first, covered: same.reduce((n, m) => n + (m.shelf?.covered ?? 0), 0) };
}

// The COTS page's Released and Order List: compact filter boxes on top (the inventory's groups,
// then a group's categories, kept in ?group=&cat=), then a General section
// (parts that belong to no robot) and one section per robot, or one per vendor, as cards or a
// table. Released has a search box that adds shelf items or new products as cards, and Send to
// order; the Order List has status filters, and a part set In Stock there is crossed out and
// moves down to In stock once the page is left. The In stock sections show a part for a week after
// it arrived, or until its X. ?part=<id> (the cart on an Inventory card) scrolls to that card and
// makes it glow.
export function CotsView({
  list,
  parts,
  robots,
  categories,
  shelf,
}: {
  list: "released" | "order";
  parts: CotsViewPart[];
  robots: { id: string; name: string }[];
  categories: InvCategory[];
  shelf?: CotsShelf;
}) {
  const edit = useEditMode();
  const [optimistic, addOptimistic] = useOptimistic(parts, (state, edits: Edit[]) =>
    state.map((p) => {
      const e = edits.find((x) => x.id === p.id);
      return e ? { ...p, ...planPartUpdate(p, e.changes, "ui").set } : p;
    }),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Parts set In Stock on this visit stay in place, crossed out.
  const [struck, setStruck] = useState<Set<string>>(new Set());
  // Parts whose X was pressed on this visit, gone before the server answers.
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [now] = useState(() => Date.now());
  const params = useSearchParams();
  const rawGroup = params.get("group");
  const group: CategoryGroupId | null = rawGroup && isCategoryGroup(rawGroup) ? rawGroup : null;
  const category = group ? params.get("cat") : null;
  const groupOfCat = new Map(categories.map((c) => [c.id, c.group]));
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [byVendor, setByVendor] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set()); // groups shown per system
  const [addTo, setAddTo] = useState<string>(""); // "" = General, else a robot id

  const places: Place[] = [{ robotId: null, name: "General" }, ...robots.map((r) => ({ robotId: r.id, name: r.name }))];

  function save(edits: Edit[]) {
    if (!edits.length) return;
    setError(null);
    if (list === "order") {
      setStruck((s) => {
        const next = new Set(s);
        for (const e of edits) {
          if (e.changes.status === COTS_IN_STOCK) next.add(e.id);
          else if (e.changes.status) next.delete(e.id);
        }
        return next;
      });
    }
    startTransition(async () => {
      addOptimistic(edits);
      const r = await updateCotsParts(edits);
      if (r.error) setError(r.error);
    });
  }
  const saveRow = (row: Row) => (changes: PartChanges) =>
    save(row.members.length === 1 ? [{ id: row.members[0].id, changes }] : spreadCotsChanges(row.members, changes));
  const clear = (ids: string[]) => {
    setCleared((s) => new Set([...s, ...ids]));
    startTransition(async () => {
      const r = await clearInStock(ids);
      if (r.error) setError(r.error);
    });
  };
  const addItem = (itemId: string) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await addCotsFromItem(itemId, addTo || null);
      if (r.error) setError(r.error);
      else setNotice(r.message ?? null);
    });
  };

  const inList = (p: CardPart) => {
    const s = computeStatus(p);
    return list === "released" ? s === COTS_RELEASED : ORDERING.includes(s) || (s === COTS_IN_STOCK && struck.has(p.id));
  };
  const shownInStock = (p: CotsViewPart) =>
    computeStatus(p) === COTS_IN_STOCK && !p.cotsClearedAt && !cleared.has(p.id) && (!p.cotsInStockAt || now - new Date(p.cotsInStockAt).getTime() < SHOWN_MS);
  const ofCategory = (p: CotsViewPart) => (!group || groupOf(groupOfCat.get(p.category)) === group) && (!category || p.category === category);
  const ofStatus = (p: CardPart) => list !== "order" || !statusFilter || computeStatus(p) === statusFilter || struck.has(p.id);
  const listed = optimistic.filter(inList);
  const main = listed.filter((p) => ofCategory(p) && ofStatus(p));
  const inStock = optimistic.filter((p) => shownInStock(p) && !struck.has(p.id) && ofCategory(p));
  const counts = new Map<string, { count: number }>();
  for (const p of listed)
    for (const key of [p.category, groupOf(groupOfCat.get(p.category))]) counts.set(key, { count: (counts.get(key)?.count ?? 0) + 1 });

  // ?part=<id>: clear a box filter that would hide it, then scroll to its card and let it glow.
  const target = params.get("part");
  useEffect(() => {
    if (!target) return;
    const part = parts.find((p) => p.id === target);
    if (part && !ofCategory(part)) pushQuery({ group: null, cat: null });
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-part~="${CSS.escape(target)}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.dataset.glow = "1";
      setTimeout(() => delete el.dataset.glow, 4000);
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per target
  }, [target]);
  const statusCounts = new Map<string, number>();
  for (const p of listed) if (ofCategory(p)) statusCounts.set(computeStatus(p), (statusCounts.get(computeStatus(p)) ?? 0) + 1);

  const rowsOf = (ps: CotsViewPart[]): Row[] =>
    groupSameCots(ps).map((members) => {
      if (members.length === 1) return { key: members[0].id, part: members[0], members };
      const [first] = members;
      const sum = (f: "quantity" | "stockCount") => members.reduce((n, m) => n + m[f], 0);
      return {
        key: `cots:${first.id}`,
        members,
        part: {
          ...first,
          id: `cots:${first.id}`,
          quantity: sum("quantity"),
          stockCount: sum("stockCount"),
          // The shelf of the first member with an item, covering every member on that item.
          shelf: shelfOf(members),
          shelfSuggestion: members.find((m) => m.shelfSuggestion)?.shelfSuggestion ?? null,
          memberIds: members.map((m) => m.id),
          systemName: [...new Set(members.map((m) => m.systemName).filter(Boolean))].join(", "),
        },
      };
    });

  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  // On Released, cards slide between the robot sections and the In order list section.
  const draggable = list === "released" && !ordering;
  const dragProps = (ids: string[], from: DragLoad["from"]) =>
    draggable
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.stopPropagation();
            e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ ids, from } satisfies DragLoad));
          },
        }
      : {};
  const dropTo = (to: DragLoad["from"]) => (load: DragLoad) => {
    if (load.from === to || !load.ids.length) return;
    save(load.ids.map((id) => ({ id, changes: to === "ordered" ? { status: COTS_ORDERED, cotsSentBack: null } : { status: COTS_RELEASED } })));
  };

  const renderRows = (rows: Row[], { small = false, from = "list", clearable = false }: { small?: boolean; from?: DragLoad["from"]; clearable?: boolean } = {}) =>
    view === "table" ? (
      <CotsTable rows={rows} saveRow={saveRow} struck={struck} orderList={list === "order" && !small} onClear={clearable ? clear : undefined} />
    ) : (
      <div className="card-grid" style={{ "--card-min": small ? "200px" : list === "order" ? "300px" : "260px" } as React.CSSProperties}>
        {rows.map((row) => {
          const grouped = row.members.length > 1;
          const crossed = row.members.every((m) => struck.has(m.id));
          const variant = list === "order" && !small ? "order" : "default";
          const ids = row.members.map((m) => m.id);
          if (grouped && open.has(row.key) && !ordering)
            return (
              <GroupBox key={row.key} row={row} onClose={() => setOpen((s) => toggle(s, row.key))} {...dragProps(ids, from)}>
                {row.members.map((m) => (
                  <div key={m.id} {...dragProps([m.id], from)}>
                    <CotsCard part={m} save={saveRow({ key: m.id, part: m, members: [m] })} showSystem highlightSystem variant={variant} shelfOnThumb struck={struck.has(m.id)} />
                  </div>
                ))}
              </GroupBox>
            );
          return (
            <div key={row.key} className="relative" {...dragProps(ids, from)}>
              <CotsCard
                part={row.part}
                save={saveRow(row)}
                showSystem
                variant={variant} shelfOnThumb
                origin={list === "released" ? originOf(row.members[0]) : undefined}
                struck={crossed}
                group={grouped && !ordering ? { systems: new Set(row.members.map((m) => m.systemId)).size, onOpen: () => setOpen((s) => toggle(s, row.key)) } : undefined}
                selected={selected.has(row.key)}
                onToggleSelect={ordering ? () => setSelected((s) => toggle(s, row.key)) : undefined}
              />
              {clearable && <ClearButton name={partTitle(row.part)} onClick={() => clear(ids)} />}
            </div>
          );
        })}
      </div>
    );

  // A list split by General and robot, each with a small heading (for the small sections and
  // the vendor sections).
  const byPlace = (ps: CotsViewPart[], opts: Parameters<typeof renderRows>[1] = {}) =>
    places.map((place) => {
      const rows = rowsOf(ps.filter((p) => p.robotId === place.robotId));
      return rows.length ? (
        <BomProvider key={place.robotId ?? "general"} value={{ inventory: [], isAdmin: false, robotId: place.robotId ?? undefined }}>
          <div className="space-y-2">
            <div className="text-xs font-semibold text-subtle">{place.name}</div>
            {renderRows(rows, opts)}
          </div>
        </BomProvider>
      ) : null;
    });

  const placeRows = places.map((place) => ({ place, rows: rowsOf(main.filter((p) => p.robotId === place.robotId)) }));
  const allRows = placeRows.flatMap((r) => r.rows);
  const vendors = [...new Set(main.map(vendorOf))].sort((a, b) => (a === NO_VENDOR ? 1 : b === NO_VENDOR ? -1 : a.localeCompare(b)));
  // Released: the parts already on the order list, in a small section below.
  const queued = list === "released" ? optimistic.filter((p) => computeStatus(p) === COTS_ORDERED && ofCategory(p)) : [];
  const sendToOrder = () => {
    const ids = allRows.filter((r) => selected.has(r.key)).flatMap((r) => r.members.map((m) => m.id));
    save(ids.map((id) => ({ id, changes: { status: COTS_ORDERED, cotsSentBack: null } })));
    setOrdering(false);
    setSelected(new Set());
  };

  return (
    <div className={`space-y-5 ${ordering ? "pb-20" : ""}`}>
      <CategoryBoxes
        compact
        categories={categories}
        counts={counts}
        group={group}
        category={category}
        onGroup={(g) => pushQuery({ group: g, cat: null })}
        onCategory={(c) => pushQuery({ cat: c })}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "cards", label: "Cards" },
            { value: "table", label: "Table" },
          ]}
        />
        <button
          type="button"
          onClick={() => setByVendor((v) => !v)}
          aria-pressed={byVendor}
          className={`press rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition-colors active:scale-[0.98] ${
            byVendor ? "border-accent bg-accent text-white" : "border-line-strong bg-raised text-muted hover:text-fg"
          }`}
        >
          Vendors
        </button>
        {list === "order" &&
          ORDERING.map((s) => {
            const color = getCotsStatus(s)?.color ?? "#94a3b8";
            const on = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter((cur) => (cur === s ? null : s))}
                aria-pressed={on}
                style={{ borderColor: color, background: on ? `${color}40` : undefined }}
                className="press flex items-center gap-2 rounded-lg border-2 px-3.5 py-1.5 text-sm font-bold text-fg transition-colors active:scale-[0.98]"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                {s}
                <span className="font-mono text-xs tabular-nums">{statusCounts.get(s) ?? 0}</span>
              </button>
            );
          })}
        {group && (
          <button type="button" onClick={() => pushQuery({ group: null, cat: null })} className="press rounded-full border border-line-strong px-3 py-1 text-xs font-medium text-fg-2 hover:text-fg">
            {categories.find((c) => c.id === category)?.label ?? groupLabel(group)} ✕
          </button>
        )}
        <span className="font-mono text-xs text-subtle tabular-nums">{allRows.length} parts</span>
        {list === "released" && (
          <div className="ml-auto flex w-full flex-wrap items-start justify-end gap-2 lg:w-auto lg:flex-nowrap">
            {edit && shelf && !ordering && (
              <>
                <select value={addTo} onChange={(e) => setAddTo(e.target.value)} className="input min-h-12 w-auto py-2 text-sm" aria-label="Add the card to">
                  {places.map((p) => (
                    <option key={p.robotId ?? ""} value={p.robotId ?? ""}>
                      Add to: {p.name}
                    </option>
                  ))}
                </select>
                <AddBoxSlot shelf={shelf} onPick={addItem} />
              </>
            )}
            <button
              onClick={() => {
                setOrdering((o) => !o);
                setSelected(new Set());
              }}
              aria-pressed={ordering}
              className={`press shrink-0 rounded-xl px-7 py-3 text-lg font-bold shadow-lg transition-colors active:scale-[0.98] ${
                ordering ? "border border-line-strong bg-surface text-fg" : "bg-amber-400 text-slate-950 shadow-amber-400/40 hover:bg-amber-300"
              }`}
            >
              {ordering ? "Cancel" : "🛒 Send to order"}
            </button>
          </div>
        )}
      </div>

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}
      {notice && !error && (
        <p className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <span className="flex-1">{notice}</span>
          <button type="button" className="press" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <Icon name="close" className="h-4 w-4" />
          </button>
        </p>
      )}

      {byVendor ? (
        vendors.length === 0 ? (
          <Empty list={list} />
        ) : (
          vendors.map((v) => {
            const ps = main.filter((p) => vendorOf(p) === v);
            return (
              <Section key={v} title={v} count={rowsOf(ps).length}>
                {byPlace(ps)}
              </Section>
            );
          })
        )
      ) : (
        <>
          {placeRows.map(({ place, rows }) =>
            place.robotId === null || rows.length ? (
              <BomProvider key={place.robotId ?? "general"} value={{ inventory: [], isAdmin: false, robotId: place.robotId ?? undefined }}>
                <Section title={place.robotId ? `In ${place.name}` : "General"} count={rows.length || undefined} onDropParts={draggable ? dropTo("list") : undefined}>
                  {rows.length ? renderRows(rows) : <p className="text-sm text-subtle">Parts that don&apos;t belong to a robot will show here.</p>}
                </Section>
              </BomProvider>
            ) : null,
          )}
          {allRows.length === 0 && <Empty list={list} />}
        </>
      )}

      {list === "released" && (
        <Section title="In order list" count={queued.length} small defaultOpen={false} onDropParts={draggable ? dropTo("ordered") : undefined}>
          {queued.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line py-6 text-center text-sm text-subtle">Drag parts here to put them on the order list.</p>
          ) : (
            byPlace(queued, { small: true, from: "ordered" })
          )}
        </Section>
      )}

      {inStock.length > 0 && (
        <Section title="In stock" count={inStock.length} small defaultOpen={false}>
          {byPlace(inStock, { small: true, clearable: true })}
        </Section>
      )}

      {ordering && (
        <div className="sticky bottom-3 z-30 rounded-xl border border-line-strong bg-surface/95 p-3 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold tabular-nums">{selected.size} selected</span>
            <span className="text-subtle">Tap the parts to order.</span>
            <span className="ml-auto" />
            <button className="btn-primary" disabled={pending || selected.size === 0} onClick={sendToOrder}>
              ✓ Send to order list
            </button>
            <button className="btn" onClick={() => setSelected(new Set(allRows.map((r) => r.key)))}>
              Select all
            </button>
            <button className="btn" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Released's search box: the Inventory page's own, handing the picked or new item to the page.
function AddBoxSlot({ shelf, onPick }: { shelf: CotsShelf; onPick: (itemId: string) => void }) {
  const [q, setQ] = useState("");
  return (
    <div className="flex min-w-0 flex-1 lg:w-[28rem] lg:flex-none">
      <AddBox q={q} setQ={setQ} {...shelf} defaultCategory={null} placeholder="Add a COTS part: type a name or paste a link" onPick={onPick} newStock="0" />
    </div>
  );
}

function Empty({ list }: { list: "released" | "order" }) {
  return (
    <p className="rounded-lg border border-dashed border-line py-8 text-center text-sm text-subtle">
      {list === "released" ? "No released COTS parts." : "Nothing on the order list."}
    </p>
  );
}

// The X on a card in an In stock section.
function ClearButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Clear from In stock"
      aria-label={`Clear ${name} from In stock`}
      className="press absolute -top-2 -right-2 z-30 flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-surface text-subtle shadow-md hover:text-fg active:scale-[0.98]"
    >
      <Icon name="close" className="h-3.5 w-3.5" />
    </button>
  );
}

function Section({
  title,
  count,
  small = false,
  defaultOpen = true,
  onDropParts,
  children,
}: {
  title: string;
  count?: number;
  small?: boolean;
  defaultOpen?: boolean;
  onDropParts?: (load: DragLoad) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [over, setOver] = useState(false);
  const dropProps = onDropParts && {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      if (raw) {
        e.preventDefault();
        onDropParts(JSON.parse(raw) as DragLoad);
      }
    },
  };
  return (
    <section {...dropProps} className={`-m-2 space-y-3 rounded-xl p-2 transition-colors ${over ? "bg-accent/5 ring-2 ring-accent/40" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="press flex w-full items-center gap-3 py-1 text-left">
        <Chevron open={open} small={small} />
        <h2 className={small ? "text-base font-semibold text-fg-2" : "display text-2xl font-bold"}>{title}</h2>
        {count !== undefined && <span className="rounded-full bg-raised px-2.5 py-0.5 font-mono text-sm font-bold text-fg-2 tabular-nums">{count}</span>}
        <div className={`flex-1 ${small ? "h-px bg-line" : "h-0.5 bg-line-strong"}`} />
      </button>
      {open && children}
    </section>
  );
}

// The same part from several systems, opened: a big card across the row with the part's name and
// total on top (click it to close) and each system's part inside, its system highlighted.
function GroupBox({ row, onClose, children, ...drag }: { row: Row; onClose: () => void; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const p = row.part;
  return (
    <div {...drag} style={{ gridColumn: "1 / -1", ...statusTint(computeStatus(p)) }} className="card-interactive flex flex-col ring-2 ring-amber-400/70 ring-offset-2 ring-offset-ink">
      <button type="button" onClick={onClose} aria-expanded className="press flex items-center gap-3 p-3 text-left">
        <span className="thumb-well thumb-cots flex h-14 w-20 shrink-0 items-center justify-center rounded-md">
          <Thumb part={p} size={52} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-fg">{partTitle(p)}</span>
          <span className="font-mono text-xs text-subtle tabular-nums">
            ×{p.quantity} in {new Set(row.members.map((m) => m.systemId)).size} systems
          </span>
        </span>
        <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-950">Close ⧉</span>
      </button>
      <div className="card-grid cursor-default border-t border-line p-3" style={{ "--card-min": "240px" } as React.CSSProperties}>
        {children}
      </div>
    </div>
  );
}

// The table ("chart") view of the same cards.
function CotsTable({
  rows,
  saveRow,
  struck,
  orderList,
  onClear,
}: {
  rows: Row[];
  saveRow: (row: Row) => (changes: PartChanges) => void;
  struck: Set<string>;
  orderList: boolean;
  onClear?: (ids: string[]) => void;
}) {
  const currency = useCurrency();
  return (
    <div className="panel overflow-x-auto">
      <table className="data-table cots-table">
        <thead>
          <tr>
            <th />
            <th>Part</th>
            <th>Systems</th>
            <th className="text-right">Qty</th>
            <th className="text-right">In stock</th>
            <th className="text-right">To order</th>
            <th className="text-right">Each</th>
            <th className="text-right">Total</th>
            <th>Where to buy</th>
            <th>Status</th>
            {onClear && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const p = row.part;
            const link = p.cotsLinks?.[0];
            const total = cotsTotal(p);
            const crossed = row.members.every((m) => struck.has(m.id));
            return (
              <tr key={row.key} className={crossed ? "opacity-60" : undefined} style={statusTint(computeStatus(p))}>
                <td>
                  <ThumbLocate part={p} />
                </td>
                <td className={`font-semibold ${crossed ? "line-through" : ""} ${row.members.length > 1 ? "text-amber-500" : ""}`}>
                  {link ? (
                    <a href={link.url} target="_blank" rel="noreferrer" className="text-sky-500 underline-offset-2 hover:underline dark:text-sky-400">
                      {partTitle(p)}
                    </a>
                  ) : (
                    partTitle(p)
                  )}
                </td>
                <td className="text-muted">{p.systemName}</td>
                <td className="text-right font-mono tabular-nums">{p.quantity}</td>
                <td className="text-right font-mono tabular-nums" title={p.shelf && !p.shelf.sheet ? `Covered by ${p.shelf.itemName} on the shelf` : undefined}>
                  {p.shelf && !p.shelf.sheet ? p.shelf.covered : p.stockCount}
                </td>
                <td className="text-right font-mono tabular-nums">{Math.max(0, p.quantity - (p.shelf && !p.shelf.sheet ? p.shelf.covered : p.stockCount)) || "—"}</td>
                <td className="text-right font-mono text-emerald-500 tabular-nums">{p.unitPrice == null ? "—" : formatPrice(p.unitPrice, currency)}</td>
                <td className="text-right font-mono font-semibold text-emerald-500 tabular-nums">{total == null ? "—" : formatPrice(total, currency)}</td>
                <td className="text-xs">
                  {(p.cotsLinks ?? []).map((l, i) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {i > 0 && ", "}
                      {siteOf(l)}
                    </a>
                  ))}
                </td>
                <td>
                  {orderList ? <OrderStatusButton part={p} save={saveRow(row)} compact /> : <StatusField part={p} save={saveRow(row)} />}
                </td>
                {onClear && (
                  <td>
                    <button type="button" onClick={() => onClear(row.members.map((m) => m.id))} className="press rounded p-1 text-subtle hover:text-fg" aria-label={`Clear ${partTitle(p)} from In stock`}>
                      <Icon name="close" className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// A table row's thumbnail: a click opens the part's place in the robot.
function ThumbLocate({ part }: { part: CardPart }) {
  const { robotId } = useBom();
  const [stage, setStage] = useState<StageView | null>(null);
  return (
    <>
      <button type="button" onClick={() => setStage(robotId ? "locate" : "part")} className="press block cursor-zoom-in" aria-label={`Locate ${partTitle(part)} in the robot`}>
        <Thumb part={part} size={44} />
      </button>
      {stage && (
        <PartStage
          partId={ownerPartId(part)}
          robotId={robotId ?? null}
          modelKey={part.modelKey}
          name={partTitle(part)}
          view={stage}
          onView={setStage}
          onClose={() => setStage(null)}
        />
      )}
    </>
  );
}
