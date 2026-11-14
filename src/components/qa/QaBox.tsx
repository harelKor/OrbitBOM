"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { updatePart } from "@/app/(app)/parts-actions";
import { Dialog } from "@/components/Dialog";
import { BomProvider, type InventoryName } from "@/components/bom/BomContext";
import { PartCard } from "@/components/bom/PartCard";
import type { CardPart } from "@/components/bom/types";
import { Icon } from "@/components/ui/Icon";
import type { PartChanges } from "@/lib/parts/changes";
import { Notice } from "@/components/ui/Notice";
import { safeAction } from "@/lib/safeAction";

export type QaSystem = { id: string; name: string; count: number };

// The robot dashboard's Ready for QA box. A click opens the systems that have parts to QA; a
// system opens a second window over it with that system's parts, each with the big check that
// moves it to In Stock, and a button to the system's page (Harel, 2026-11-07). `glow`: CAD Team,
// while parts wait. On a PC its text sizes to the box (container units), so a short box
// (a small or zoomed screen) never cuts the number off.
export function QaBox({
  robotId,
  systems,
  parts,
  inventory,
  isAdmin,
  glow = false,
}: {
  robotId: string;
  systems: QaSystem[];
  parts: CardPart[]; // the robot's parts in Ready for QA
  inventory: InventoryName[];
  isAdmin: boolean;
  glow?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The system picked, kept as it was so its window stays open once all its parts are checked off.
  const [system, setSystem] = useState<QaSystem | null>(null);
  const systemId = system?.id ?? null;
  // Parts checked off while the window is open, as they were when checked: they stay, struck
  // through, after the page's data drops them, so a second click can undo.
  const [checked, setChecked] = useState<Map<string, CardPart>>(() => new Map());
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const total = systems.reduce((n, s) => n + s.count, 0);
  const own = parts.filter((p) => p.systemId === systemId && !checked.has(p.id));
  const shown = [...own, ...[...checked.values()].filter((p) => p.systemId === systemId)];

  const save = (id: string, changes: PartChanges, onFail?: () => void) => {
    setError(null);
    startTransition(async () => {
      const r = await safeAction(() => updatePart(id, changes));
      if (r.error) {
        setError(r.error);
        onFail?.();
      }
    });
  };
  const toggle = (part: CardPart) => {
    const undo = checked.has(part.id);
    setChecked((c) => {
      const next = new Map(c);
      if (undo) next.delete(part.id);
      else next.set(part.id, part);
      return next;
    });
    // A failed save (or an offline tap) unticks the part again, so the tick never lies.
    const back = () =>
      setChecked((c) => {
        const next = new Map(c);
        if (undo) next.set(part.id, part);
        else next.delete(part.id);
        return next;
      });
    save(part.id, { status: undo ? "Ready for QA" : "In Stock" }, back);
  };
  const closeSystem = () => {
    setSystem(null);
    setChecked(new Map());
    setError(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-arrival={glow ? "" : undefined}
        className="card-interactive group flex min-h-32 flex-col justify-between gap-2 overflow-hidden p-4 text-left active:scale-[0.98] sm:p-5 @5xl/dash:[container-type:size]"
      >
        <span className="min-w-0">
          <span className="block text-xl leading-tight font-bold text-fg sm:text-2xl @5xl/dash:text-[min(1.5rem,11.5cqw,11cqh)]">Ready for QA</span>
          {total > 0 && (
            <span className="mt-1 block truncate text-base text-subtle tabular-nums @5xl/dash:text-[min(1rem,8cqh)]">
              in {systems.length} {systems.length === 1 ? "system" : "systems"}
            </span>
          )}
        </span>
        <span className="display font-mono text-7xl leading-none text-accent tabular-nums sm:text-8xl @5xl/dash:text-[min(6rem,36cqh,40cqw)]">{total}</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Ready for QA" wide>
        {systems.length === 0 ? (
          <p className="text-sm text-muted">No parts are waiting for QA.</p>
        ) : (
          <ul className="space-y-2">
            {systems.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => setSystem(s)} className="card-interactive group flex w-full items-center gap-3 px-4 py-3 text-left active:scale-[0.98]">
                  <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono text-sm font-bold text-amber-500 tabular-nums">{s.count}</span>
                  <Icon name="arrow" className="h-4 w-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <Dialog
        open={!!system}
        onClose={closeSystem}
        title={system ? `Ready for QA · ${system.name}` : "Ready for QA"}
        wide
        actions={
          system && (
            <Link
              href={`/robots/${robotId}/systems/${system.id}`}
              onClick={() => {
                closeSystem();
                setOpen(false);
              }}
              className="btn-primary inline-flex items-center gap-1.5"
            >
              System page
              <Icon name="arrow" className="h-4 w-4" />
            </Link>
          )
        }
      >
        {error && <Notice tone="error" className="mb-3">Couldn&apos;t save: {error}</Notice>}
        {shown.length === 0 ? (
          <p className="text-sm text-muted">No parts in this system are waiting for QA.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-subtle">Check a part off to move it to In Stock.</p>
            <BomProvider value={{ inventory, isAdmin, robotId }}>
              <div className="card-grid">
                {shown.map((p) => (
                  <PartCard key={p.id} part={p} save={(changes) => save(p.id, changes)} checked={checked.has(p.id)} onCheck={() => toggle(p)} />
                ))}
              </div>
            </BomProvider>
          </>
        )}
      </Dialog>
    </>
  );
}
