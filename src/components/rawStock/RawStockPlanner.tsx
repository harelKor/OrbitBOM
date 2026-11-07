"use client";

import { useMemo, useState, useTransition } from "react";
import { setRawStockSize } from "@/app/(app)/robots/[robotId]/inventory/actions";
import { Dialog } from "@/components/Dialog";
import { parseCustomSize, planGroup, sizeLabel, type RawGroup, type RawPart, type RawPlan } from "@/lib/fab/rawStock";

// The robot's Raw stock planner (Harel, 2026-11-07): a card per stock group showing its layout,
// opening a window where the piece size can be switched and the count follows. Parts are coloured
// by their status; "done" counts parts at Post Processing or later.
export function RawStockPlanner({ robotId, groups, canEdit }: { robotId: string; groups: RawGroup[]; canEdit: boolean }) {
  const [sizes, setSizes] = useState<Record<string, string>>(() => Object.fromEntries(groups.map((g) => [g.key, g.size])));
  const [extra, setExtra] = useState<Record<string, string[]>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Every group's layout, worked out here in the browser (the server never nests).
  const plans = useMemo(() => new Map(groups.map((g) => [g.key, planGroup(g, sizes[g.key] ?? g.size)])), [groups, sizes]);

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
              <Thumbnail group={g} plan={plan} />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold" title={g.title}>
                    {g.title}
                  </div>
                  <div className="truncate text-[11px] text-muted">
                    {g.subtitle} · {sizeLabel(size)}
                  </div>
                </div>
                <div className="shrink-0 text-right text-accent">
                  <div className="font-mono text-2xl leading-none font-semibold tabular-nums">{plan.pieces.length}</div>
                  <div className="text-[10px] font-semibold tracking-wide uppercase">{plan.pieces.length === 1 ? "piece" : "pieces"}</div>
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
          onSize={(s) => choose(current, s)}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

// Material used and parts done, as two thin bars.
function Bars({ plan }: { plan: RawPlan }) {
  const done = plan.copies ? plan.madeCopies / plan.copies : 0;
  return (
    <div className="grid grid-cols-2 gap-3 text-[11px] text-muted">
      <div>
        <div className="flex justify-between">
          <span>Material used</span>
          <span className="font-mono text-fg tabular-nums">{pct(plan.usage)}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-accent" style={{ width: pct(plan.usage) }} />
        </div>
      </div>
      <div>
        <div className="flex justify-between">
          <span>Done</span>
          <span className="font-mono text-fg tabular-nums">
            {pct(done)} <span className="text-subtle">· {plan.madeCopies}/{plan.copies}</span>
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: pct(done) }} />
        </div>
      </div>
    </div>
  );
}

function Warnings({ group, plan }: { group: RawGroup; plan: RawPlan }) {
  if (!plan.tooBig.length && !group.missing.length) return null;
  return (
    <div className="space-y-0.5 text-[11px] text-amber-600">
      {plan.tooBig.length > 0 && <div>{plan.tooBig.length === 1 ? "1 part is" : `${plan.tooBig.length} parts are`} bigger than the piece</div>}
      {group.missing.length > 0 && <div>{group.missing.length === 1 ? "1 part has" : `${group.missing.length} parts have`} no size</div>}
    </div>
  );
}

// The card's picture: the first pieces as they're laid out.
function Thumbnail({ group, plan }: { group: RawGroup; plan: RawPlan }) {
  const byId = useMemo(() => new Map(group.parts.map((p) => [p.partId, p])), [group.parts]);
  if (!plan.pieces.length) return <div className="flex h-28 items-center justify-center rounded-lg bg-raised text-xs text-subtle">Nothing to lay out</div>;
  if (group.kind === "length") {
    const shown = plan.pieces.slice(0, 6);
    return (
      <div className="flex h-28 flex-col justify-center gap-1.5 rounded-lg bg-raised p-2">
        {shown.map((piece, i) => (
          <LengthBar key={i} plan={plan} piece={piece} byId={byId} thin />
        ))}
        {plan.pieces.length > shown.length && <div className="text-right text-[10px] text-subtle">+{plan.pieces.length - shown.length} more</div>}
      </div>
    );
  }
  const shown = plan.pieces.slice(0, 3);
  return (
    <div className="flex h-28 items-center justify-center gap-2 rounded-lg bg-raised p-2">
      {shown.map((piece, i) => (
        <PlateSheet key={i} plan={plan} piece={piece} byId={byId} className="h-full max-w-[33%] min-w-0" />
      ))}
      {plan.pieces.length > shown.length && <span className="shrink-0 text-[10px] text-subtle">+{plan.pieces.length - shown.length}</span>}
    </div>
  );
}

type Piece = RawPlan["pieces"][number];

function PlateSheet({ plan, piece, byId, className = "", labels = false }: { plan: RawPlan; piece: Piece; byId: Map<string, RawPart>; className?: string; labels?: boolean }) {
  const { pieceW: W, pieceH: H } = plan;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${W}×${H} piece`}>
      <rect x={0} y={0} width={W} height={H} fill="var(--color-surface)" stroke="var(--color-line-strong)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {piece.items.map((it) => {
        const part = byId.get(it.partId);
        const y = it.y; // drawn as To Fab's Auto Layout draws it: y down the screen
        return (
          <g key={`${it.partId}-${it.copy}`}>
            <rect x={it.x} y={y} width={it.w} height={it.h} rx={Math.min(it.w, it.h) * 0.04} fill={part?.color ?? "#94a3b8"} fillOpacity={0.85} stroke="rgba(0,0,0,0.45)" strokeWidth={1} vectorEffect="non-scaling-stroke">
              <title>{`${part?.name ?? ""} · ${part?.status ?? ""} · ${Math.round(it.w)}×${Math.round(it.h)}`}</title>
            </rect>
            {labels && it.w > W * 0.12 && it.h > H * 0.06 && (
              <text x={it.x + it.w / 2} y={y + it.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={Math.min(it.h * 0.3, W * 0.025)} fill="#0b0f17" pointerEvents="none">
                {part?.name.slice(0, 18)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function LengthBar({ plan, piece, byId, thin = false }: { plan: RawPlan; piece: Piece; byId: Map<string, RawPart>; thin?: boolean }) {
  const L = plan.pieceW || 1;
  return (
    <div className={`relative w-full overflow-hidden rounded-sm border border-line-strong bg-surface ${thin ? "h-3" : "h-9"}`}>
      {piece.items.map((it) => {
        const part = byId.get(it.partId);
        return (
          <div
            key={`${it.partId}-${it.copy}`}
            title={`${part?.name ?? ""} · ${part?.status ?? ""} · ${Math.round(it.w)} mm`}
            className="absolute inset-y-0 flex items-center justify-center overflow-hidden border-r border-black/40 text-[10px] whitespace-nowrap text-[#0b0f17]"
            style={{ left: `${(it.x / L) * 100}%`, width: `${(it.w / L) * 100}%`, background: part?.color ?? "#94a3b8" }}
          >
            {!thin && it.w / L > 0.12 && <span className="truncate px-1">{part?.name}</span>}
          </div>
        );
      })}
    </div>
  );
}

function PlannerWindow({ group, plan, size, extra, onSize, onClose }: { group: RawGroup; plan: RawPlan; size: string; extra: string[]; onSize: (s: string) => void; onClose: () => void }) {
  const [custom, setCustom] = useState("");
  const byId = useMemo(() => new Map(group.parts.map((p) => [p.partId, p])), [group.parts]);
  const choices = [...group.sizes, ...extra.filter((e) => !group.sizes.some((s) => s.size === e)).map((e) => ({ size: e, label: sizeLabel(e), onShelf: 0 }))];
  const typed = parseCustomSize(custom, group.kind);
  const statuses = [...new Map(group.parts.map((p) => [p.status, p.color])).entries()];
  const last = plan.pieces.at(-1);
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
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
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
              <div className="flex justify-between text-[11px] text-subtle">
                <span>Piece {i + 1}</span>
                <span className="tabular-nums">{pct(piece.used)} used</span>
              </div>
              {group.kind === "plate" ? <PlateSheet plan={plan} piece={piece} byId={byId} className="w-full" labels /> : <LengthBar plan={plan} piece={piece} byId={byId} />}
            </div>
          ))}
        </div>

        {(plan.tooBig.length > 0 || group.missing.length > 0) && (
          <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
            {plan.tooBig.map((id) => (
              <div key={id}>
                <span className="font-semibold">{byId.get(id)?.name}</span> <span className="text-muted">doesn&apos;t fit on a {sizeLabel(size)} piece.</span>
              </div>
            ))}
            {group.missing.map((m) => (
              <div key={m.partId}>
                <span className="font-semibold">{m.name}</span> <span className="text-muted">{m.reason}</span>
              </div>
            ))}
          </div>
        )}

        <div>
          <div className="mb-1 text-xs font-semibold text-muted">Parts · {group.parts.length}</div>
          <ul className="space-y-0.5 text-xs">
            {group.parts.map((p) => (
              <li key={p.partId} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} />
                <span className="min-w-0 flex-1 truncate text-muted">
                  {p.systemName} › <span className="text-fg">{p.name}</span>
                  {p.approx && <span className="text-subtle"> · size from its bounding box</span>}
                </span>
                <span className="shrink-0 text-[11px] text-subtle">{p.status}</span>
                <span className="shrink-0 font-mono text-muted tabular-nums">
                  {group.kind === "plate" ? `${Math.round(p.w)}×${Math.round(p.h)}` : `${Math.round(p.w)} mm`} ×{p.quantity}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel p-3 max-sm:p-2">
      <div className="truncate text-[11px] font-semibold text-muted">{label}</div>
      <div className="display font-mono text-3xl text-accent tabular-nums max-sm:text-2xl">{value}</div>
      {sub && <div className="text-[10px] text-subtle tabular-nums">{sub}</div>}
    </div>
  );
}
