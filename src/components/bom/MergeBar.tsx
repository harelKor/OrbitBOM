"use client";

import { useState, useTransition } from "react";
import { mergeParts } from "@/app/(app)/parts-actions";
import { partTitle, type CardPart } from "./types";

export type MergeInfo = { id: string; name: string; partIds: string[] };

// FRCBOM's Merge parts (ref §3): combine selected rows into one row with the summed quantity
// and a chosen name. Unmerge from the merged card.
export function MergeBar({ systemId, selected, onDone }: { systemId: string; selected: CardPart[]; onDone: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const qty = selected.reduce((n, p) => n + p.quantity, 0);
  const suggested = selected[0] ? (selected[0].displayName ?? selected[0].onshapeName ?? partTitle(selected[0])) : "";

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-700 bg-slate-900/95 p-3 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">
          {selected.length} selected{selected.length > 0 && ` · total quantity ${qty}`}
        </span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested || "Merged part name"} className="input w-56" />
        <button
          className="btn-primary"
          disabled={pending || selected.length < 2}
          title={selected.length < 2 ? "Pick two or more parts" : undefined}
          onClick={() =>
            startTransition(async () => {
              const r = await mergeParts(systemId, name.trim() || suggested, selected.map((p) => p.id));
              setError(r.error ?? null);
              if (!r.error) onDone();
            })
          }
        >
          Merge
        </button>
        <button className="btn ml-auto" onClick={onDone}>
          Done
        </button>
        {error && <span className="w-full text-rose-300">{error}</span>}
      </div>
    </div>
  );
}
