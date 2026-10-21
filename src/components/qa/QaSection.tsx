"use client";

import { useOptimistic, useState, useTransition } from "react";
import { updatePart } from "@/app/(app)/parts-actions";
import { BomProvider, type InventoryName } from "@/components/bom/BomContext";
import { PartCard } from "@/components/bom/PartCard";
import type { PartChanges } from "@/lib/parts/changes";
import type { CardPart } from "@/components/bom/types";

// The top of a system page: the parts waiting for QA, each with a big check mark. Checking a
// part off moves it to In Stock (it leaves this section at once, and comes back if the save fails).
export function QaSection({ parts, inventory, isAdmin, robotId }: { parts: CardPart[]; inventory: InventoryName[]; isAdmin: boolean; robotId: string }) {
  const [shown, hide] = useOptimistic(parts, (state, id: string) => state.filter((p) => p.id !== id));
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(id: string, changes: PartChanges) {
    setError(null);
    startTransition(async () => {
      if (changes.status === "In Stock") hide(id);
      const result = await updatePart(id, changes);
      if (result.error) setError(result.error);
    });
  }

  if (shown.length === 0 && !error) return null;
  return (
    <section id="qa" className="scroll-mt-20 space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.04] p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-bold">Ready for QA</h2>
        <span className="font-mono text-sm text-subtle tabular-nums">{shown.length}</span>
        <span className="text-xs text-subtle">Check a part off to move it to In Stock.</span>
      </div>
      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}
      <BomProvider value={{ inventory, isAdmin, robotId }}>
        <div className="card-grid">
          {shown.map((p) => (
            <PartCard key={p.id} part={p} save={(changes) => save(p.id, changes)} onCheck={() => save(p.id, { status: "In Stock" })} />
          ))}
        </div>
      </BomProvider>
    </section>
  );
}
