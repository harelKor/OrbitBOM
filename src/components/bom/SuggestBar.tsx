"use client";

import { useState } from "react";
import { suggestParts } from "@/app/(app)/parts-actions";
import { SuggestIcon } from "@/components/ui/SuggestIcon";
import type { CardPart } from "./types";

// System page → Suggest: pick any parts (set up or not) and get fresh setup suggestions plus
// inventory links for them. Each changed part waits in To Review with its old → new values.
export function SuggestBar({
  selected,
  total,
  onSelectAll,
  onSelectUndefined,
  onClear,
  onDone,
}: {
  selected: CardPart[];
  total: number;
  onSelectAll: () => void;
  onSelectUndefined: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A merged row stands for its members.
  const ids = [...new Set(selected.flatMap((p) => p.memberIds ?? [p.id]))];

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await suggestParts(ids);
      if (r.error) setError(r.error);
      else {
        setResult(r.message ?? null);
        onClear();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-0 left-[var(--shell-left)] right-[var(--shell-right)] z-40 border-t border-line-strong bg-surface/95 p-3 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold tabular-nums">{selected.length} selected</span>
        <button className="btn" onClick={onSelectAll} disabled={busy || selected.length === total}>
          Select all
        </button>
        <button className="btn" onClick={onSelectUndefined} disabled={busy}>
          Select undefined
        </button>
        <button className="btn" onClick={onClear} disabled={busy || selected.length === 0}>
          Clear
        </button>
        <button className="btn-primary inline-flex items-center gap-1.5" onClick={run} disabled={busy || ids.length === 0}>
          <SuggestIcon className="h-4 w-4" />
          {busy ? "Suggesting…" : `Suggest setup for ${ids.length} part${ids.length === 1 ? "" : "s"}`}
        </button>
        <button className="btn ml-auto" onClick={onDone} disabled={busy}>
          Done
        </button>
        {result && <span className="w-full text-fg-2">{result}</span>}
        {error && <span className="w-full text-rose-700">{error}</span>}
      </div>
    </div>
  );
}
