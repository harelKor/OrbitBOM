"use client";

import { useEffect, useState, useTransition } from "react";
import { updatePart } from "@/app/(app)/parts-actions";
import { BomProvider, type InventoryName } from "@/components/bom/BomContext";
import { PartCard } from "@/components/bom/PartCard";
import type { PartChanges } from "@/lib/parts/changes";
import { safeAction } from "@/lib/safeAction";
import type { CardPart } from "@/components/bom/types";
import { Notice } from "@/components/ui/Notice";
import { isBoughtQa, qaNext } from "@/lib/status";

// The top of a system page: the parts waiting for QA, each with a big check mark. Checking a
// part off moves it to In Stock and strikes it through; it stays here until the member leaves
// the page, so a second click can undo it. The box starts closed with a glowing outline so leads
// notice it (Harel, 2026-11-01); a link to #qa (the dashboard's QA box) opens it.
export function QaSection({ parts, inventory, isAdmin, robotId }: { parts: CardPart[]; inventory: InventoryName[]; isAdmin: boolean; robotId: string }) {
  // Parts checked off on this visit, as they were when checked (the server no longer lists them).
  const [checked, setChecked] = useState<Map<string, CardPart>>(() => new Map());
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const openOnHash = () => {
      if (window.location.hash === "#qa") setOpen(true);
    };
    openOnHash();
    window.addEventListener("hashchange", openOnHash);
    return () => window.removeEventListener("hashchange", openOnHash);
  }, []);
  const shown = [...parts.filter((p) => !checked.has(p.id)), ...checked.values()];

  function save(id: string, changes: PartChanges, onFail?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await safeAction(() => updatePart(id, changes));
      if (result.error) {
        setError(result.error);
        onFail?.();
      }
    });
  }
  function toggle(part: CardPart) {
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
    // Approval moves it on: In Stock, or to its next process when QA came before one (Harel, 2026-11-20).
    save(part.id, { qa: undo ? "reopen" : "approve" }, back);
  }

  if (shown.length === 0 && !error) return null;
  const left = shown.length - checked.size;
  return (
    <details
      id="qa"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group scroll-mt-20 rounded-lg border border-amber-400/60 bg-amber-500/[0.04] shadow-[0_0_22px_-4px_rgba(251,191,36,0.38)] ring-1 ring-amber-400/35"
    >
      <summary className="flex cursor-pointer list-none items-baseline gap-2 p-4 select-none [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-xs text-amber-500 transition-transform group-open:rotate-90">▶</span>
        <h2 className="text-lg font-bold">Ready for QA</h2>
        <span className="font-mono text-sm text-subtle tabular-nums">{left}</span>
        <span className="hidden text-xs text-subtle sm:inline">Check a part off to approve it: In Stock, or on to its next process.</span>
      </summary>
      <div className="space-y-3 px-4 pb-4">
        {error && <Notice tone="error">Couldn&apos;t save: {error}</Notice>}
        {open && (
          <BomProvider value={{ inventory, isAdmin, robotId }}>
            <QaGrid parts={shown} card={(p) => <PartCard key={p.id} part={p} save={(changes) => save(p.id, changes)} checked={checked.has(p.id)} onCheck={() => toggle(p)} checkTo={qaNext(p)} />} />
          </BomProvider>
        )}
      </div>
    </details>
  );
}

// The parts to QA, split into COTS (just bought) and Shop (just made) only when both have parts;
// otherwise one grid as before (Harel, 2026-11-20).
export function QaGrid({ parts, card }: { parts: CardPart[]; card: (p: CardPart) => React.ReactNode }) {
  const bought = parts.filter(isBoughtQa);
  const made = parts.filter((p) => !isBoughtQa(p));
  if (!bought.length || !made.length) return <div className="card-grid">{parts.map(card)}</div>;
  return (
    <div className="space-y-4">
      {[
        ["COTS", bought],
        ["Shop", made],
      ].map(([title, list]) => (
        <section key={title as string} className="space-y-2">
          <h3 className="text-sm font-bold tracking-wide text-subtle uppercase">
            {title as string} <span className="font-mono tabular-nums">{(list as CardPart[]).length}</span>
          </h3>
          <div className="card-grid">{(list as CardPart[]).map(card)}</div>
        </section>
      ))}
    </div>
  );
}
