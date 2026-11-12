"use client";

import { useMemo, useState, useTransition } from "react";
import { setRawStockSize } from "@/app/(app)/robots/[robotId]/inventory/actions";
import { Dialog } from "@/components/Dialog";
import { openPartWindow } from "@/components/bom/PartDetailsHost";
import { placePoint, type Pt } from "@/lib/fab/layout";
import { parseCustomSize, planGroup, sizeLabel, type RawGroup, type RawPart, type RawPlan } from "@/lib/fab/rawStock";
import { useFlatOutlines, type Flat } from "./useFlatOutlines";

// The robot's Raw stock planner (Harel, 2026-11-07): a card per stock group showing its layout,
// opening a window where the piece size can be switched and the count follows. Parts are coloured
// by their status; "done" counts parts at Post Processing or later.
export function RawStockPlanner({ robotId, groups, canEdit }: { robotId: string; groups: RawGroup[]; canEdit: boolean }) {
  const [sizes, setSizes] = useState<Record<string, string>>(() => Object.fromEntries(groups.map((g) => [g.key, g.size])));
  const [extra, setExtra] = useState<Record<string, string[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // The plate parts' real outlines, loaded after the page shows.
  const flats = useFlatOutlines(robotId);
  // Every group's layout, worked out here in the browser (the server never nests).
  const plans = useMemo(() => new Map(groups.map((g) => [g.key, planGroup(g, sizes[g.key] ?? g.size, flats)])), [groups, sizes, flats]);

  const choose = (g: RawGroup, size: string) => {
    setSizes((s) => ({ ...s, [g.key]: size }));
    if (!g.sizes.some((s) => s.size === size)) setExtra((e) => ({ ...e, [g.key]: [...new Set([...(e[g.key] ?? []), size])] }));
    if (!canEdit) return;
    startTransition(async () => {
      const res = await setRawStockSize(robotId, g.key, size);
      setError(res.error ?? null);
    });
  };

  if (!groups.length)
    return (
      <div className="panel p-6 text-sm text-muted">
        No plate, tube or box tube parts yet. Set a part&apos;s material to a Raw Stock item (or give it a material) and they show here.
      </div>
    );

  const current = groups.find((g) => g.key === open) ?? null;
  return (
    <>
      <div className="card-grid" style={{ "--card-min": "260px" } as React.CSSProperties}>
        {groups.map((g) => {
          const plan = plans.get(g.key)!;
          const size = sizes[g.key] ?? g.size;
          return (
            <button key={g.key} type="button" onClick={() => setOpen(g.key)} className="card-interactive flex flex-col gap-3 p-3 text-left active:scale-[0.98]">
              <Thumbnail group={g} plan={plan} flats={flats} />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold" title={g.title}>
                    {g.title}
                  </div>
                  <div className="truncate text-[0.6875rem] text-muted">
                    {g.subtitle} · {sizeLabel(size)}
                  </div>
                </div>
                <div className="shrink-0 text-right text-accent">
                  <div className="font-mono text-2xl leading-none font-semibold tabular-nums">{plan.pieces.length}</div>
                  <div className="text-[0.625rem] font-semibold tracking-wide uppercase">{plan.pieces.length === 1 ? "piece" : "pieces"}</div>
                </div>
              </div>
              <Bars plan={plan} />
              <Warnings group={g} plan={plan} />
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
      {current && (
        <PlannerWindow
          group={current}
          plan={plans.get(current.key)!}
          size={sizes[current.key] ?? current.size}
          extra={extra[current.key] ?? []}
          flats={flats}
          onSize={(s) => choose(current, s)}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

// Material used, as one thin bar. The cards stay simple: how done the parts are shows in the
// window (Harel, 2026-11-07).
function Bars({ plan }: { plan: RawPlan }) {
  return (
    <div className="text-[0.6875rem] text-muted">
      <div className="flex justify-between">
        <span>Material used</span>
        <span className="font-mono text-fg tabular-nums">{pct(plan.usage)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-accent" style={{ width: pct(plan.usage) }} />
      </div>
    </div>
  );
}

function Warnings({ group, plan }: { group: RawGroup; plan: RawPlan }) {
  if (!plan.tooBig.length && !group.missing.length) return null;
  return (
    <div className="space-y-0.5 text-[0.6875rem] text-amber-600">
      {plan.tooBig.length > 0 && <div>{plan.tooBig.length === 1 ? "1 part is" : `${plan.tooBig.length} parts are`} bigger than the piece</div>}
      {group.missing.length > 0 && <div>{group.missing.length === 1 ? "1 part has" : `${group.missing.length} parts have`} no size</div>}
    </div>
  );
}

// The card's picture: the first pieces as they're laid out, each cropped to where its parts are
// so they fill the picture (Harel, 2026-11-07).
function Thumbnail({ group, plan, flats }: { group: RawGroup; plan: RawPlan; flats: Map<string, Flat> }) {
  const byId = useMemo(() => new Map(group.parts.map((p) => [p.partId, p])), [group.parts]);
  if (!plan.pieces.length) return <div className="flex h-28 items-center justify-center rounded-lg bg-raised text-xs text-subtle">Nothing to lay out</div>;
  if (group.kind === "length") {
    const shown = plan.pieces.slice(0, 6);
    return (
      <div className="flex h-28 flex-col justify-center gap-1.5 rounded-lg bg-raised p-2">
        {shown.map((piece, i) => (
          <LengthBar key={i} plan={plan} piece={piece} byId={byId} thin />
        ))}
        {plan.pieces.length > shown.length && <div className="text-right text-[0.625rem] text-subtle">+{plan.pieces.length - shown.length} more</div>}
      </div>
    );
  }
  const shown = plan.pieces.slice(0, 4);
  return (
    <div className="flex h-28 items-center justify-center gap-2 rounded-lg bg-raised p-2">
      {shown.map((piece, i) => (
        <PlateSheet key={i} plan={plan} piece={piece} byId={byId} flats={flats} crop className="h-full min-w-0 flex-1" />
      ))}
      {plan.pieces.length > shown.length && <span className="shrink-0 text-[0.625rem] text-subtle">+{plan.pieces.length - shown.length}</span>}
    </div>
  );
}

type Piece = RawPlan["pieces"][number];

const loopPath = (loop: Pt[], place: { x: number; y: number; rotation: number }) =>
  loop
    .map((pt, i) => {
      const [x, y] = placePoint(pt, place);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ") + "Z";

// One piece with its parts: their real outlines where the 3D shape is loaded, else their boxes.
// `crop`: only the area of the piece the parts take (thumbnails). `onPart`: a click on a part.
function PlateSheet({
  plan,
  piece,
  byId,
  flats,
  className = "",
  labels = false,
  crop = false,
  onPart,
}: {
  plan: RawPlan;
  piece: Piece;
  byId: Map<string, RawPart>;
  flats: Map<string, Flat>;
  className?: string;
  labels?: boolean;
  crop?: boolean;
  onPart?: (partId: string) => void;
}) {
  const { pieceW: W, pieceH: H } = plan;
  let view = [0, 0, W, H];
  if (crop && piece.items.length) {
    const pad = Math.max(W, H) * 0.02;
    const x0 = Math.max(0, Math.min(...piece.items.map((i) => i.x)) - pad);
    const y0 = Math.max(0, Math.min(...piece.items.map((i) => i.y)) - pad);
    const x1 = Math.min(W, Math.max(...piece.items.map((i) => i.x + i.w)) + pad);
    const y1 = Math.min(H, Math.max(...piece.items.map((i) => i.y + i.h)) + pad);
    view = [x0, y0, x1 - x0, y1 - y0];
  }
  return (
    <svg viewBox={view.join(" ")} className={className} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${W}×${H} piece`}>
      <rect x={0} y={0} width={W} height={H} fill="var(--color-surface)" stroke="var(--color-line-strong)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {piece.items.map((it) => {
        const part = byId.get(it.partId);
        const flat = flats.get(it.partId);
        const look = { fill: part?.color ?? "#94a3b8", fillOpacity: 0.85, stroke: "rgba(0,0,0,0.5)", strokeWidth: 1, vectorEffect: "non-scaling-stroke" as const };
        const tip = `${part?.name ?? ""} · ${part?.status ?? ""} · ${Math.round(it.w)}×${Math.round(it.h)}`;
        return (
          <g key={`${it.partId}-${it.copy}`} onClick={onPart ? () => onPart(it.partId) : undefined} className={onPart ? "cursor-pointer hover:opacity-75" : undefined}>
            {flat && it.place ? (
              <path d={[flat.outline, ...flat.holes].map((l) => loopPath(l, it.place!)).join(" ")} fillRule="evenodd" {...look}>
                <title>{tip}</title>
              </path>
            ) : (
              <rect x={it.x} y={it.y} width={it.w} height={it.h} rx={Math.min(it.w, it.h) * 0.04} {...look}>
                <title>{tip}</title>
              </rect>
            )}
            {labels && it.w > W * 0.12 && it.h > H * 0.06 && (
              <text x={it.x + it.w / 2} y={it.y + it.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(it.h * 0.3, W * 0.025)} fill="#0b0f17" pointerEvents="none">
                {part?.name.slice(0, 18)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function LengthBar({ plan, piece, byId, thin = false, onPart }: { plan: RawPlan; piece: Piece; byId: Map<string, RawPart>; thin?: boolean; onPart?: (partId: string) => void }) {
  const L = plan.pieceW || 1;
  return (
    <div className={`relative w-full overflow-hidden rounded-sm border border-line-strong bg-surface ${thin ? "h-3" : "h-9"}`}>
      {piece.items.map((it) => {
        const part = byId.get(it.partId);
        const style = { left: `${(it.x / L) * 100}%`, width: `${(it.w / L) * 100}%`, background: part?.color ?? "#94a3b8" };
        const title = `${part?.name ?? ""} · ${part?.status ?? ""} · ${Math.round(it.w)} mm`;
        const cls = "absolute inset-y-0 flex items-center justify-center overflow-hidden border-r border-black/40 text-[0.625rem] whitespace-nowrap text-[#0b0f17]";
        const label = !thin && it.w / L > 0.12 && <span className="truncate px-1">{part?.name}</span>;
        return onPart ? (
          <button key={`${it.partId}-${it.copy}`} type="button" title={title} onClick={() => onPart(it.partId)} className={`${cls} cursor-pointer hover:opacity-75`} style={style}>
            {label}
          </button>
        ) : (
          <div key={`${it.partId}-${it.copy}`} title={title} className={cls} style={style}>
            {label}
          </div>
        );
      })}
    </div>
  );
}

function PlannerWindow({ group, plan, size, extra, flats, onSize, onClose }: { group: RawGroup; plan: RawPlan; size: string; extra: string[]; flats: Map<string, Flat>; onSize: (s: string) => void; onClose: () => void }) {
  const [custom, setCustom] = useState("");
  const byId = useMemo(() => new Map(group.parts.map((p) => [p.partId, p])), [group.parts]);
  const choices = [...group.sizes, ...extra.filter((e) => !group.sizes.some((s) => s.size === e)).map((e) => ({ size: e, label: sizeLabel(e), onShelf: 0 }))];
  const typed = parseCustomSize(custom, group.kind);
  const statuses = [...new Map(group.parts.map((p) => [p.status, p.color])).entries()];
  const last = plan.pieces.at(-1);
  const openPart = (partId: string) => void openPartWindow(partId);
  return (
    <Dialog open onClose={onClose} title={group.title} width="w-[min(56rem,calc(100vw-1rem))]" sheet>
      <div className="space-y-4 p-5 max-sm:p-3">
        <div>
          <div className="mb-1.5 text-xs font-semibold text-muted">Stock piece</div>
          <div className="flex flex-wrap gap-1.5">
            {choices.map((c) => (
              <button
                key={c.size}
                type="button"
                onClick={() => onSize(c.size)}
                className={`press min-h-9 rounded-full border px-3 py-1 text-xs font-semibold tabular-nums ${c.size === size ? "border-accent bg-accent/10 text-accent" : "border-line-strong text-fg-2"}`}
              >
                {c.label}
                {c.onShelf > 0 && <span className="ml-1 font-normal text-subtle">· {c.onShelf} on shelf</span>}
              </button>
            ))}
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed) {
                  onSize(typed);
                  setCustom("");
                }
              }}
            >
              <input
                className="input h-9 w-32 text-xs"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder={group.kind === "plate" ? "W×H mm" : "Length mm"}
                inputMode={group.kind === "plate" ? "text" : "numeric"}
                aria-label="Custom piece size"
              />
              <button type="submit" className="btn press h-9 text-xs" disabled={!typed}>
                Use
              </button>
            </form>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 max-sm:gap-2">
          <Stat label="Pieces" value={String(plan.pieces.length)} sub={`of ${sizeLabel(size)}`} />
          <Stat label="Material used" value={pct(plan.usage)} />
          <Stat label="Done" value={pct(plan.copies ? plan.madeCopies / plan.copies : 0)} sub={`${plan.madeCopies}/${plan.copies} copies`} />
        </div>
        {last && plan.pieces.length > 1 && <p className="text-xs text-muted">The last piece is {pct(last.used)} used.</p>}

        {statuses.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-muted">
            {statuses.map(([s, color]) => (
              <span key={s} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
                {s}
              </span>
            ))}
          </div>
        )}

        <div className={group.kind === "plate" ? "grid gap-3 sm:grid-cols-2" : "space-y-2"}>
          {plan.pieces.map((piece, i) => (
            <div key={i} className="space-y-1">
              <div className="flex justify-between text-[0.6875rem] text-subtle">
                <span>Piece {i + 1}</span>
                <span className="tabular-nums">{pct(piece.used)} used</span>
              </div>
              {group.kind === "plate" ? (
                <PlateSheet plan={plan} piece={piece} byId={byId} flats={flats} className="w-full" labels onPart={openPart} />
              ) : (
                <LengthBar plan={plan} piece={piece} byId={byId} onPart={openPart} />
              )}
            </div>
          ))}
        </div>

        {(plan.tooBig.length > 0 || group.missing.length > 0) && (
          <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
            {plan.tooBig.map((id) => (
              <div key={id}>
                <button type="button" onClick={() => openPart(id)} className="font-semibold hover:text-accent">
                  {byId.get(id)?.name}
                </button>{" "}
                <span className="text-muted">doesn&apos;t fit on a {sizeLabel(size)} piece.</span>
              </div>
            ))}
            {group.missing.map((m) => (
              <div key={m.partId}>
                <button type="button" onClick={() => openPart(m.partId)} className="font-semibold hover:text-accent">
                  {m.name}
                </button>{" "}
                <span className="text-muted">{m.reason}</span>
              </div>
            ))}
          </div>
        )}

        <details className="group/parts rounded-lg border border-line">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold select-none">
            <span className="text-muted transition-transform group-open/parts:rotate-90">›</span>
            Parts · {group.parts.length}
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {group.parts.map((p) => (
              <li key={p.partId}>
                <button type="button" onClick={() => openPart(p.partId)} className="flex min-h-10 w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-raised active:scale-[0.98]">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: p.color }} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted">{p.systemName} › </span>
                    <span className="font-medium">{p.name}</span>
                    {p.approx && <span className="text-xs text-subtle"> · size from its bounding box</span>}
                  </span>
                  <span className="shrink-0 text-xs text-subtle max-sm:hidden">{p.status}</span>
                  <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
                    {group.kind === "plate" ? `${Math.round(p.w)}×${Math.round(p.h)}` : `${Math.round(p.w)} mm`} ×{p.quantity}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Dialog>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel p-3 max-sm:p-2">
      <div className="truncate text-[0.6875rem] font-semibold text-muted">{label}</div>
      <div className="display font-mono text-3xl text-accent tabular-nums max-sm:text-2xl">{value}</div>
      {sub && <div className="text-[0.625rem] text-subtle tabular-nums">{sub}</div>}
    </div>
  );
}
