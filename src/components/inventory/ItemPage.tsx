"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { adjustStock, deleteItem, linkPartsToItem } from "@/app/(app)/inventory/actions";
import { textOn } from "@/components/bom/options";
import { EditOnly, useCan } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { Dialog } from "@/components/Dialog";
import { activeFields, getCategory, specLine } from "@/lib/inventory/categories";
import type { ItemHistoryEntry } from "@/lib/data/inventory";
import { formatStock, snapStock } from "@/lib/inventory/stock";
import { PieceStepper, ProductName, conditionColor, hostOf } from "./ItemCard";
import { ItemForm, draftOf } from "./ItemForm";
import { ItemHistory } from "./ItemHistory";
import { ToBomDialog } from "./ToBomDialog";
import type { BomTarget, Condition, Group, InvCategory, Item, Location } from "./types";

type Match = { partId: string; name: string; quantity: number; robotName: string; systemName: string; reason: "onshape" | "link" | "name" };

const REASONS = { onshape: "same Onshape part", link: "same product page", name: "same name" } as const;

// The item page: on the left the picture, the stock with its − / +, and the item's details; on
// the right every part that draws on it (by robot), COTS parts that look like it with a Link
// button, and the latest stock changes.
export function ItemPage({
  item: initial,
  conditions,
  locations,
  groups,
  categories,
  matches,
  history,
  targets,
}: {
  item: Item;
  conditions: Condition[];
  locations: Location[];
  groups: Group[];
  categories: InvCategory[];
  matches: Match[];
  history: ItemHistoryEntry[];
  targets: BomTarget[];
}) {
  const work = useCan("work");
  const router = useRouter();
  const [item, step] = useOptimistic(initial, (s, d: number) => ({ ...s, inStock: snapStock(s.inStock + d, s.sheet) }));
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<"edit" | "toBom" | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);

  const onStep = (d: number) =>
    startTransition(async () => {
      step(d);
      const r = await adjustStock(item.id, d);
      if (r.error) setResult(r);
    });
  const link = (ids: string[]) =>
    startTransition(async () => {
      setResult(await linkPartsToItem(item.id, ids));
      setPicked(new Set());
    });

  const category = getCategory(categories, item.category);
  const condition = conditions.find((c) => c.id === item.conditionId);
  const color = condition ? conditionColor(condition.color) : undefined;
  const location = locations.find((l) => l.id === (item.locationId ?? groups.find((g) => g.id === item.groupId)?.locationId))?.name;
  const spec = specLine(category, item.specs);
  const [draft, setDraft] = useState(() => draftOf(initial));
  const usage = item.usage;
  const byRobot = new Map<string, NonNullable<typeof usage>["parts"]>();
  for (const p of usage?.parts ?? []) byRobot.set(p.robotName, [...(byRobot.get(p.robotName) ?? []), p]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section className="card-interactive flex h-fit flex-col border-l-4" style={color ? { borderLeftColor: color } : undefined}>
        <div className="thumb-well relative flex aspect-[4/3] items-center justify-center">
          {item.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
            <img src={item.thumbUrl} alt="" className="h-full w-full object-contain p-6" />
          ) : (
            <Icon name="box" className="h-16 w-16 text-subtle" />
          )}
          <div className="absolute top-3 left-3 flex flex-wrap gap-1">
            {category && <span className="rounded-full bg-[#111318]/85 px-2.5 py-0.5 text-xs font-semibold text-white">{category.label}</span>}
            {condition && (
              <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: color, color: textOn(color!) }}>
                {condition.label}
              </span>
            )}
          </div>
          {location && <span className="absolute top-3 right-3 rounded-full border border-line bg-surface/90 px-2.5 py-0.5 text-xs font-semibold text-fg-2">📍 {location}</span>}
        </div>
        <div className="space-y-4 p-4">
          <div>
            <h1 className="display text-3xl break-words text-accent">
              <ProductName item={item} />
            </h1>
            {spec && <div className="font-mono text-sm text-muted tabular-nums">{spec}</div>}
          </div>
          <div className="flex items-center gap-3">
            {work && (<button
              type="button"
              onClick={() => onStep(-1)}
              disabled={item.inStock < 1}
              className="press flex h-12 w-12 items-center justify-center rounded-lg bg-rose-500 text-2xl font-bold text-white hover:bg-rose-400 disabled:opacity-30"
              aria-label="One less"
            >
              −
            </button>)}
            <div className="min-w-0 flex-1 text-center">
              <div className="display font-mono text-5xl text-fg tabular-nums">{formatStock(item.inStock, item.sheet)}</div>
              <div className="text-xs text-muted">
                {item.sheet ? "sheets on the shelf" : usage?.need ? `on the shelf · robots need ${usage.need}` : "on the shelf"}
                {!!usage?.short && <span className="font-semibold text-amber-600"> · {usage.short} short</span>}
              </div>
            </div>
            {work && (<button
              type="button"
              onClick={() => onStep(1)}
              className="press flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-500 text-2xl font-bold text-white hover:bg-emerald-400"
              aria-label="One more"
            >
              +
            </button>)}
          </div>
          {item.sheet && (
            <div className="flex justify-center">
              <span className="rounded-full bg-[#111318]/80 px-3 py-1 text-xs text-white">
                Pieces of a sheet <PieceStepper onStep={onStep} max={item.inStock} />
              </span>
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {(category ? activeFields(category, item.specs) : [])
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
                <dd className="font-mono text-emerald-600 tabular-nums">${item.price.toFixed(2)}</dd>
              </>
            )}
          </dl>
          <EditOnly>
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <button
                className="btn"
                onClick={() => {
                  setDraft(draftOf(initial));
                  setOpen("edit");
                }}
              >
                <Icon name="pencil" className="h-4 w-4" /> Edit
              </button>
              <button className="btn" onClick={() => setOpen("toBom")}>
                To BOM
              </button>
              <button
                className="btn ml-auto text-rose-700"
                onClick={() => {
                  const warn = usage?.parts.length ? ` ${usage.parts.length} BOM parts will no longer draw from it.` : "";
                  if (!confirm(`Delete "${item.name}" from the inventory?${warn}`)) return;
                  startTransition(async () => {
                    await deleteItem(item.id);
                    router.push("/inventory");
                  });
                }}
              >
                Delete
              </button>
            </div>
          </EditOnly>
          {result?.error && <p className="text-sm text-rose-700">{result.error}</p>}
          {result?.message && <p className="text-sm text-emerald-700">{result.message}</p>}
        </div>
      </section>

      <div className="space-y-4">
        <section className="panel p-4">
          <h2 className="mb-2 font-semibold">Used in</h2>
          {byRobot.size === 0 ? (
            <p className="text-sm text-muted">No robot part is linked to this item yet.</p>
          ) : (
            <div className="space-y-3">
              {[...byRobot].map(([robot, ps]) => (
                <div key={robot}>
                  <div className="mb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">{robot}</div>
                  <ul className="divide-y divide-line text-sm">
                    {ps.map((p) => {
                      const covered = usage!.coveredOf.get(p.partId) ?? 0;
                      return (
                        <li key={p.partId} className="flex items-center gap-2 py-1.5">
                          <Link href={p.systemId ? `/robots/${p.robotId}/systems/${p.systemId}#part-${p.partId}` : p.robotId ? `/robots/${p.robotId}` : "/cots/released"} className="min-w-0 flex-1 truncate hover:text-accent">
                            <span className="text-muted">{p.systemName} › </span>
                            {p.partName}
                          </Link>
                          {p.status && <span className="shrink-0 text-xs text-subtle">{p.status}</span>}
                          {item.sheet ? (
                            <span className="shrink-0 font-mono text-xs tabular-nums">×{p.quantity}</span>
                          ) : (
                            <span className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${covered < p.quantity ? "text-amber-600" : "text-emerald-600"}`}>
                              {covered}/{p.quantity}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {matches.length > 0 && (
          <section className="panel p-4">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="flex-1 font-semibold">Possible matches</h2>
              <button className="btn" disabled={pending || !picked.size} onClick={() => link([...picked])}>
                Link {picked.size || ""}
              </button>
              <button className="btn-primary" disabled={pending} onClick={() => link(matches.map((m) => m.partId))}>
                Link all
              </button>
            </div>
            <p className="mb-2 text-xs text-muted">COTS parts with no inventory item that look like this one.</p>
            <ul className="divide-y divide-line text-sm">
              {matches.map((m) => (
                <li key={m.partId}>
                  <label className="flex cursor-pointer items-center gap-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={picked.has(m.partId)}
                      onChange={() =>
                        setPicked((s) => {
                          const next = new Set(s);
                          if (next.has(m.partId)) next.delete(m.partId);
                          else next.add(m.partId);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-muted">
                        {m.robotName} › {m.systemName} ›{" "}
                      </span>
                      {m.name} <span className="font-mono text-xs tabular-nums">×{m.quantity}</span>
                    </span>
                    <span className="shrink-0 text-xs text-subtle">{REASONS[m.reason]}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel p-4">
          <h2 className="mb-2 font-semibold">History</h2>
          <ItemHistory history={history} sheet={item.sheet} categories={categories} locations={locations} conditions={conditions} />
        </section>
      </div>

      <Dialog open={open === "edit"} onClose={() => setOpen(null)} title="Edit inventory item" wide>
        {open === "edit" && (
          <ItemForm
            itemId={item.id}
            draft={draft}
            setDraft={setDraft}
            categories={categories}
            locations={locations}
            conditions={conditions}
            items={[]}
            onCancel={() => setOpen(null)}
            onSaved={(_, message) => {
              setOpen(null);
              if (message) setResult({ message });
            }}
          />
        )}
      </Dialog>
      <ToBomDialog key={open === "toBom" ? "bom" : "closed-bom"} item={open === "toBom" ? initial : null} targets={targets} onClose={() => setOpen(null)} />
    </div>
  );
}
