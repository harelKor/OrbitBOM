"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { COTS_CATEGORIES, COTS_IN_STOCK, COTS_ORDERED, COTS_RELEASED, ORDER_STATUSES, type CotsCategoryId } from "@/config/cots";
import { updateCotsParts } from "@/app/(app)/cots/actions";
import { BomProvider } from "@/components/bom/BomContext";
import { StatusField } from "@/components/bom/fields";
import { Thumb } from "@/components/bom/Thumb";
import { partTitle, type CardPart } from "@/components/bom/types";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { cotsCategoryOf, cotsTotal, groupSameCots, siteOf, spreadCotsChanges } from "@/lib/cots";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";
import { CotsCard } from "./CotsCard";
import { formatPrice, useCurrency } from "./currency";

export type CotsViewPart = CardPart & { robotId: string; robotName: string };
type Edit = { id: string; changes: PartChanges };
// One card: a part, or the same part from several systems (members) shown with the total amount.
type Row = { key: string; part: CardPart; members: CardPart[] };

const ORDERING = ORDER_STATUSES.filter((s) => s !== COTS_IN_STOCK) as string[];

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

  const renderRows = (rows: Row[], small = false) =>
    view === "table" ? (
      <CotsTable rows={rows} saveRow={saveRow} struck={struck} />
    ) : (
      <div className="card-grid" style={{ "--card-min": small ? "200px" : list === "order" ? "300px" : "260px" } as React.CSSProperties}>
        {rows.flatMap((row) => {
          const grouped = row.members.length > 1;
          const isOpen = grouped && open.has(row.key);
          const onToggle = () => setOpen((s) => toggle(s, row.key));
          const cards = isOpen ? row.members.map((m) => ({ key: m.id, part: m, save: saveRow({ key: m.id, part: m, members: [m] }) })) : [{ key: row.key, part: row.part, save: saveRow(row) }];
          return cards.map((c) => (
            <CotsCard
              key={c.key}
              part={c.part}
              save={c.save}
              showSystem
              variant={list === "order" && !small ? "order" : "default"}
              struck={row.members.every((m) => struck.has(m.id))}
              group={grouped ? { systems: new Set(row.members.map((m) => m.systemId)).size, open: isOpen, onToggle } : undefined}
              selected={selected.has(row.key)}
              onToggleSelect={ordering ? () => setSelected((s) => toggle(s, row.key)) : undefined}
            />
          ));
        })}
      </div>
    );

  const robotRows = robots
    .map((r) => ({ robot: r, rows: rowsOf(main.filter((p) => p.robotId === r.id && ofCategory(p))) }))
    .filter((r) => r.rows.length > 0);
  const allRows = robotRows.flatMap((r) => r.rows);
  const sendToOrder = () => {
    const ids = allRows.filter((r) => selected.has(r.key)).flatMap((r) => r.members.map((m) => m.id));
    save(ids.map((id) => ({ id, changes: { status: COTS_ORDERED } })));
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
          <Section title={`In ${robot.name}`} count={rows.length}>
            {renderRows(rows)}
          </Section>
        </BomProvider>
      ))}

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

function Section({ title, count, small = false, defaultOpen = true, children }: { title: string; count?: number; small?: boolean; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="space-y-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="press flex w-full items-center gap-3 text-left">
        <Icon name="chevron" className={`shrink-0 text-subtle transition-transform ${open ? "rotate-90" : ""} ${small ? "h-4 w-4" : "h-5 w-5"}`} />
        <h2 className={small ? "text-base font-semibold text-fg-2" : "display text-2xl font-bold"}>{title}</h2>
        {count !== undefined && <span className="rounded-full bg-raised px-2.5 py-0.5 font-mono text-sm font-bold text-fg-2 tabular-nums">{count}</span>}
        <div className={`flex-1 ${small ? "h-px bg-line" : "h-0.5 bg-line-strong"}`} />
      </button>
      {open && children}
    </section>
  );
}

// The table ("chart") view of the same cards.
function CotsTable({ rows, saveRow, struck }: { rows: Row[]; saveRow: (row: Row) => (changes: PartChanges) => void; struck: Set<string> }) {
  const currency = useCurrency();
  const th = "px-2 py-2 text-left text-[11px] font-semibold tracking-wide text-muted uppercase whitespace-nowrap";
  const td = "px-2 py-1.5";
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line">
          <tr>
            <th className={th} />
            <th className={th}>Part</th>
            <th className={th}>Systems</th>
            <th className={`${th} text-right`}>Qty</th>
            <th className={`${th} text-right`}>In stock</th>
            <th className={`${th} text-right`}>Each</th>
            <th className={`${th} text-right`}>Total</th>
            <th className={th}>Where to buy</th>
            <th className={th}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => {
            const p = row.part;
            const link = p.cotsLinks?.[0];
            const total = cotsTotal(p);
            const crossed = row.members.every((m) => struck.has(m.id));
            return (
              <tr key={row.key} className={crossed ? "opacity-60" : undefined}>
                <td className="py-1 pl-2">
                  <Thumb part={p} />
                </td>
                <td className={`${td} font-semibold ${crossed ? "line-through" : ""} ${row.members.length > 1 ? "text-amber-500" : ""}`}>
                  {link ? (
                    <a href={link.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
                      {partTitle(p)}
                    </a>
                  ) : (
                    partTitle(p)
                  )}
                </td>
                <td className={`${td} text-muted`}>{p.systemName}</td>
                <td className={`${td} text-right font-mono tabular-nums`}>{p.quantity}</td>
                <td className={`${td} text-right font-mono tabular-nums`}>{p.stockCount}</td>
                <td className={`${td} text-right font-mono text-emerald-500 tabular-nums`}>{p.unitPrice == null ? "—" : formatPrice(p.unitPrice, currency)}</td>
                <td className={`${td} text-right font-mono font-semibold text-emerald-500 tabular-nums`}>{total == null ? "—" : formatPrice(total, currency)}</td>
                <td className={`${td} text-xs`}>
                  {(p.cotsLinks ?? []).map((l, i) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {i > 0 && ", "}
                      {siteOf(l)}
                    </a>
                  ))}
                </td>
                <td className={td}>
                  <StatusField part={p} save={saveRow(row)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
