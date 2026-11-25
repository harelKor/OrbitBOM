"use client";

import { useState, useTransition } from "react";
import { mergeParts } from "@/app/(app)/parts-actions";
import { Dialog } from "@/components/Dialog";
import { partTitle, type CardPart } from "./types";
import { safeAction } from "@/lib/safeAction";

export type MergeInfo = { id: string; name: string; partIds: string[] };

// FRCBOM's Merge parts (ref §3): combine selected rows into one row with the summed quantity
// and a chosen name. Parts with different names ask first, since they're likely not the same
// part. Unmerge from the merged card's Merged tag.
export function MergeBar({ systemId, selected, onDone }: { systemId: string; selected: CardPart[]; onDone: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [warn, setWarn] = useState(false);
  const [pending, startTransition] = useTransition();
  const qty = selected.reduce((n, p) => n + p.quantity, 0);
  const suggested = selected[0] ? (selected[0].displayName ?? selected[0].onshapeName ?? partTitle(selected[0])) : "";
  const names = [...new Map(selected.map((p) => [partTitle(p).trim().toLowerCase(), partTitle(p)])).values()];

  const merge = () =>
    startTransition(async () => {
      const r = await safeAction(() => mergeParts(systemId, name.trim() || suggested, selected.map((p) => p.id)));
      setError(r.error ?? null);
      setWarn(false);
      if (!r.error) onDone();
    });

  return (
    <div className="fixed bottom-0 left-[var(--shell-left)] right-[var(--shell-right)] z-40 border-t border-line-strong bg-surface/95 p-3 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold tabular-nums">
          {selected.length} selected{selected.length > 0 && ` · total quantity ${qty}`}
        </span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested || "Merged part name"} className="input w-56" />
        <button
          className="btn-primary"
          disabled={pending || selected.length < 2}
          title={selected.length < 2 ? "Pick two or more parts" : undefined}
          onClick={() => (names.length > 1 ? setWarn(true) : merge())}
        >
          Merge
        </button>
        <button className="btn ml-auto" onClick={onDone}>
          Done
        </button>
        {error && <span className="w-full text-rose-700">{error}</span>}
      </div>
      <Dialog open={warn} onClose={() => setWarn(false)} title="These parts have different names">
        <div className="space-y-4 text-sm">
          <p className="text-fg-2">Merging shows them as one part, so check they really are the same part:</p>
          <ul className="space-y-1">
            {names.map((n) => (
              <li key={n} className="truncate rounded-md border border-line bg-raised px-2.5 py-1.5 font-medium text-fg">
                {n}
              </li>
            ))}
          </ul>
          <p className="text-fg-2">
            The merged part will be called <span className="font-semibold text-fg">{name.trim() || suggested}</span>.
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={() => setWarn(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={pending} onClick={merge}>
              {pending ? "Merging…" : "Merge anyway"}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
