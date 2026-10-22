"use client";

import { useState, useTransition } from "react";
import { updatePart } from "@/app/(app)/parts-actions";
import { BomProvider, type InventoryName } from "@/components/bom/BomContext";
import { PartCard } from "@/components/bom/PartCard";
import type { PartChanges } from "@/lib/parts/changes";
import type { CardPart } from "@/components/bom/types";

// The top of a system page: the parts waiting for QA, each with a big check mark. Checking a
// part off moves it to In Stock and strikes it through; it stays here until the member leaves
// the page, so a second click can undo it.
export function QaSection({ parts, inventory, isAdmin, robotId }: { parts: CardPart[]; inventory: InventoryName[]; isAdmin: boolean; robotId: string }) {
  // Parts checked off on this visit, as they were when checked (the server no longer lists them).
  const [checked, setChecked] = useState<Map<string, CardPart>>(() => new Map());
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const shown = [...parts.filter((p) => !checked.has(p.id)), ...checked.values()];

  function save(id: string, changes: PartChanges) {
    setError(null);
    startTransition(async () => {
      const result = await updatePart(id, changes);
      if (result.error) setError(result.error);
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
    save(part.id, { status: undo ? "Ready for QA" : "In Stock" });
  }

  if (shown.length === 0 && !error) return null;
  const left = shown.length - checked.size;
  return (
    <section id="qa" className="scroll-mt-20 space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.04] p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-bold">Ready for QA</h2>
        <span className="font-mono text-sm text-subtle tabular-nums">{left}</span>
        <span className="text-xs text-subtle">Check a part off to move it to In Stock.</span>
      </div>
      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}
      <BomProvider value={{ inventory, isAdmin, robotId }}>
        <div className="card-grid">
          {shown.map((p) => (
            <PartCard key={p.id} part={p} save={(changes) => save(p.id, changes)} checked={checked.has(p.id)} onCheck={() => toggle(p)} />
          ))}
        </div>
      </BomProvider>
    </section>
  );
}
