"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { COTS_CATEGORIES, COTS_IN_STOCK, COTS_ORDERED, COTS_RELEASED, ORDER_STATUSES, type CotsCategoryId } from "@/config/cots";
import { updateCotsParts } from "@/app/(app)/cots/actions";
import { BomProvider, useBom } from "@/components/bom/BomContext";
import { PartStage, type StageView } from "@/components/dashboard/PartStage";
import { statusTint } from "@/components/ui/statusTint";
import { StatusField } from "@/components/bom/fields";
import { Thumb } from "@/components/bom/Thumb";
import { ownerPartId, partTitle, type CardPart } from "@/components/bom/types";
import { Chevron } from "@/components/ui/Chevron";
import { Segmented } from "@/components/ui/Segmented";
import { cotsCategoryOf, cotsTotal, groupSameCots, siteOf, spreadCotsChanges } from "@/lib/cots";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";
import { CotsCard, OrderStatusButton } from "./CotsCard";
import { formatPrice, useCurrency } from "./currency";

export type CotsViewPart = CardPart & { robotId: string; robotName: string };
type Edit = { id: string; changes: PartChanges };
// One card: a part, or the same part from several systems (members) shown with the total amount.
type Row = { key: string; part: CardPart; members: CardPart[] };
// Dragging cards between Released's robot sections and its In order list section.
const DRAG_TYPE = "application/x-orbit-cots";
type DragLoad = { ids: string[]; from: "list" | "ordered" };

const ORDERING = ORDER_STATUSES.filter((s) => s !== COTS_IN_STOCK) as string[];

function shelfOf(members: CardPart[]) {
  const first = members.find((m) => m.shelf)?.shelf;
  if (!first) return null;
  const same = members.filter((m) => m.shelf?.itemId === first.itemId);
  return { ...first, covered: same.reduce((n, m) => n + (m.shelf?.covered ?? 0), 0) };
}

// The COTS page's Released and Order List: filter boxes on top, then a General section (parts that
// belong to no robot) and one section per robot, as cards or a table. Released has Send to order;
// on the Order List a part set In Stock is crossed out and moves down to In stock once the page
// is left.
export function CotsView({ list, parts, robots }: { list: "released" | "order"; parts: CotsViewPart[]; robots: { id: string; name: string }[] }) {
  const [optimistic, addOptimistic] = useOptimistic(parts, (state, edits: Edit[]) =>
    state.map((p) => {
      const e = edits.find((x) => x.id === p.id);
      return e ? { ...p, ...planPartUpdate(p, e.changes, "ui").set } : p;
    }),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Parts set In Stock on this visit stay in place, crossed out.
  const [struck, setStruck] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<CotsCategoryId | null>(null);
  const [view, setView] = useState<"cards" | "table">("cards");
  const [ordering, setOrdering] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set()); // groups shown per system

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

  const inList = (p: CardPart) => {
    const s = computeStatus(p);
    return list === "released" ? s === COTS_RELEASED : ORDERING.includes(s) || (s === COTS_IN_STOCK && struck.has(p.id));
  };
  const main = optimistic.filter(inList);
  const inStock = list === "order" ? optimistic.filter((p) => computeStatus(p) === COTS_IN_STOCK && !struck.has(p.id)) : [];
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of main) c.set(cotsCategoryOf(p), (c.get(cotsCategoryOf(p)) ?? 0) + 1);
    return c;
  }, [main]);
  const ofCategory = (p: CardPart) => !category || cotsCategoryOf(p) === category;

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
          systemName: [...new Set(members.map((m) => m.systemName))].join(", "),
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

  const renderRows = (rows: Row[], small = false, from: DragLoad["from"] = "list") =>
    view === "table" ? (
      <CotsTable rows={rows} saveRow={saveRow} struck={struck} orderList={list === "order" && !small} />
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
                    <CotsCard part={m} save={saveRow({ key: m.id, part: m, members: [m] })} showSystem highlightSystem variant={variant} struck={struck.has(m.id)} />
                  </div>
                ))}
              </GroupBox>
            );
          return (
            <div key={row.key} {...dragProps(ids, from)}>
              <CotsCard
                part={row.part}
                save={saveRow(row)}
                showSystem
                variant={variant}
                struck={crossed}
                group={grouped && !ordering ? { systems: new Set(row.members.map((m) => m.systemId)).size, onOpen: () => setOpen((s) => toggle(s, row.key)) } : undefined}
                selected={selected.has(row.key)}
                onToggleSelect={ordering ? () => setSelected((s) => toggle(s, row.key)) : undefined}
              />
            </div>
          );
        })}
      </div>
    );

  const robotRows = robots
    .map((r) => ({ robot: r, rows: rowsOf(main.filter((p) => p.robotId === r.id && ofCategory(p))) }))
    .filter((r) => r.rows.length > 0);
  const allRows = robotRows.flatMap((r) => r.rows);
  // Released: the parts already on the order list, in a small section below.
  const queued = list === "released" ? optimistic.filter((p) => computeStatus(p) === COTS_ORDERED && ofCategory(p)) : [];
  const sendToOrder = () => {
    const ids = allRows.filter((r) => selected.has(r.key)).flatMap((r) => r.members.map((m) => m.id));
    save(ids.map((id) => ({ id, changes: { status: COTS_ORDERED, cotsSentBack: null } })));
    setOrdering(false);
    setSelected(new Set());
  };

  return (
    <div className={`space-y-6 ${ordering ? "pb-20" : ""}`}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {COTS_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory((cur) => (cur === c.id ? null : c.id))}
            data-selected={category === c.id}
            className="card-interactive group relative flex aspect-[4/3] flex-col justify-end overflow-hidden text-left"
          >
            {c.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- static pictures from /public
              <img src={c.image} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
            ) : (
              // Placeholder until the box's picture arrives.
              <span className="absolute inset-0 bg-gradient-to-br from-accent/25 via-raised to-amber-400/20" />
            )}
            <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <span className="relative p-3">
              <span className="block text-sm leading-tight font-bold text-white drop-shadow">{c.label}</span>
              <span className="font-mono text-xs text-white/80 tabular-nums">{counts.get(c.id) ?? 0}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "cards", label: "Cards" },
            { value: "table", label: "Table" },
          ]}
        />
        {category && (
          <button type="button" onClick={() => setCategory(null)} className="press rounded-full border border-line-strong px-3 py-1 text-xs font-medium text-fg-2 hover:text-fg">
            {COTS_CATEGORIES.find((c) => c.id === category)!.label} ✕
          </button>
        )}
        <span className="text-xs text-subtle tabular-nums">{allRows.length} parts</span>
        {list === "released" && (
          <button
            onClick={() => {
              setOrdering((o) => !o);
              setSelected(new Set());
            }}
            aria-pressed={ordering}
            className={`press ml-auto rounded-xl px-7 py-3 text-lg font-bold shadow-lg transition-colors ${
              ordering ? "border border-line-strong bg-surface text-fg" : "bg-amber-400 text-slate-950 shadow-amber-400/40 hover:bg-amber-300"
            }`}
          >
            {ordering ? "Cancel" : "🛒 Send to order"}
          </button>
        )}
      </div>

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}

      <Section title="General">
        <p className="text-sm text-subtle">Parts that don&apos;t belong to a robot will show here.</p>
      </Section>
      {robotRows.length === 0 && (
        <p className="rounded-lg border border-dashed border-line py-8 text-center text-sm text-subtle">
          {list === "released" ? "No released COTS parts." : "Nothing on the order list."}
        </p>
      )}
      {robotRows.map(({ robot, rows }) => (
        <BomProvider key={robot.id} value={{ inventory: [], isAdmin: false, robotId: robot.id }}>
          <Section title={`In ${robot.name}`} count={rows.length} onDropParts={draggable ? dropTo("list") : undefined}>
            {renderRows(rows)}
          </Section>
        </BomProvider>
      ))}

      {list === "released" && (
        <Section title="In order list" count={queued.length} small defaultOpen={false} onDropParts={draggable ? dropTo("ordered") : undefined}>
          {queued.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line py-6 text-center text-sm text-subtle">Drag parts here to put them on the order list.</p>
          ) : (
            robots.map((r) => {
              const rows = rowsOf(queued.filter((p) => p.robotId === r.id));
              return rows.length ? (
                <BomProvider key={r.id} value={{ inventory: [], isAdmin: false, robotId: r.id }}>
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-subtle">{r.name}</div>
                    {renderRows(rows, true, "ordered")}
                  </div>
                </BomProvider>
              ) : null;
            })
          )}
        </Section>
      )}

      {list === "order" && inStock.length > 0 && (
        <Section title="In stock" count={inStock.length} small defaultOpen={false}>
          {robots.map((r) => {
            const rows = rowsOf(inStock.filter((p) => p.robotId === r.id && ofCategory(p)));
            return rows.length ? (
              <BomProvider key={r.id} value={{ inventory: [], isAdmin: false, robotId: r.id }}>
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-subtle">{r.name}</div>
                  {renderRows(rows, true)}
                </div>
              </BomProvider>
            ) : null;
          })}
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
function CotsTable({ rows, saveRow, struck, orderList }: { rows: Row[]; saveRow: (row: Row) => (changes: PartChanges) => void; struck: Set<string>; orderList: boolean }) {
  const currency = useCurrency();
  return (
    <div className="panel overflow-x-auto">
      <table className="data-table">
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
          material={part.material}
          onshapeMaterial={part.geometry?.onshapeMaterial ?? null}
          view={stage}
          onView={setStage}
          onClose={() => setStage(null)}
        />
      )}
    </>
  );
}
