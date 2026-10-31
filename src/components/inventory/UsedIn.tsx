"use client";

import { useState } from "react";
import { openPartWindow } from "@/components/bom/PartDetailsHost";
import { Chevron } from "@/components/ui/Chevron";
import type { ItemUsage, UsagePart } from "@/lib/inventory/usage";

// An item's "Used in": folded until opened (Harel, 2026-10-31). Parts from several robots sit
// under a fold per robot, and a robot's parts from several systems under a fold per system; one
// robot with several systems shows the system folds only, and one system lists the parts as they
// are. A click on a part opens its details window on top of this page.
export function UsedIn({ usage, sheet, className = "" }: { usage: ItemUsage; sheet: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const ps = usage.parts;
  const robots = groupBy(ps, (p) => p.robotId);
  const systems = new Set(ps.map(systemKey)).size;
  const only = ps[0];
  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-1 text-left">
        <Chevron open={open} small />
        <span className="label mb-0">
          Used in <span className="font-mono tabular-nums">({ps.length})</span>
        </span>
        {robots.length === 1 && systems === 1 && only && (
          <span className="min-w-0 flex-1 truncate text-right text-xs text-muted">{trail(only)}</span>
        )}
      </button>
      {open && (
        <div className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-line text-sm">
          {robots.length > 1 ? (
            robots.map(([, rp]) => (
              <Fold key={rp[0].robotId || "general"} title={rp[0].robotName} count={rp.length}>
                <Systems parts={rp} usage={usage} sheet={sheet} />
              </Fold>
            ))
          ) : (
            <Systems parts={ps} usage={usage} sheet={sheet} />
          )}
        </div>
      )}
    </div>
  );
}

function Systems({ parts, usage, sheet }: { parts: UsagePart[]; usage: ItemUsage; sheet: boolean }) {
  const bySystem = groupBy(parts, systemKey);
  if (bySystem.length === 1) return <Rows parts={parts} usage={usage} sheet={sheet} />;
  return bySystem.map(([key, sp]) => (
    <Fold key={key} title={sp[0].systemName || "COTS"} count={sp.length} nested>
      <Rows parts={sp} usage={usage} sheet={sheet} />
    </Fold>
  ));
}

function Fold({ title, count, nested = false, children }: { title: string; count: number; nested?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`flex w-full items-center gap-1 py-1 pr-2 text-left font-semibold hover:bg-raised ${nested ? "pl-4 text-xs" : "pl-1"}`}
      >
        <Chevron open={open} small />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="shrink-0 font-mono text-xs text-muted tabular-nums">{count}</span>
      </button>
      {open && <div className={nested ? "pl-4" : "pl-2"}>{children}</div>}
    </div>
  );
}

function Rows({ parts, usage, sheet }: { parts: UsagePart[]; usage: ItemUsage; sheet: boolean }) {
  const [opening, setOpening] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const show = async (partId: string) => {
    setOpening(partId);
    setFailed(null);
    const ok = await openPartWindow(partId);
    setOpening(null);
    if (!ok) setFailed(partId);
  };
  return (
    <ul className="divide-y divide-line">
      {parts.map((p) => {
        const covered = usage.coveredOf.get(p.partId) ?? 0;
        return (
          <li key={p.partId}>
            <button
              type="button"
              onClick={() => show(p.partId)}
              disabled={opening === p.partId}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-raised active:scale-[0.98] disabled:opacity-60"
            >
              <span className="min-w-0 flex-1 truncate">{p.partName}</span>
              {failed === p.partId && <span className="shrink-0 text-xs text-amber-600">Not found</span>}
              {p.status && <span className="shrink-0 text-xs text-subtle">{p.status}</span>}
              {sheet ? (
                <span className="shrink-0 font-mono text-xs tabular-nums">×{p.quantity}</span>
              ) : (
                <span className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${covered < p.quantity ? "text-amber-600" : "text-emerald-600"}`}>
                  {covered}/{p.quantity}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const systemKey = (p: UsagePart) => `${p.robotId}:${p.systemId ?? ""}`;
const trail = (p: UsagePart) => [p.robotName, p.systemName].filter(Boolean).join(" › ");

function groupBy<T>(list: T[], key: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const t of list) m.set(key(t), [...(m.get(key(t)) ?? []), t]);
  return [...m];
}
