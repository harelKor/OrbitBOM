"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MakeSummary } from "@/lib/drawing/make";
import { partTitle, type CardPart } from "./types";

// System page, Edit mode → Drawings: pick parts (or Select all) and make their fabrication
// drawings from Onshape. Plates, square tubes, hex shafts and round tubes get one; the rest are
// listed as skipped. Calls again while the server says some are left.
export function DrawingsBar({
  systemId,
  selected,
  total,
  onSelectAll,
  onDone,
}: {
  systemId: string;
  selected: CardPart[];
  total: number;
  onSelectAll: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A merged row stands for its members; each gets its own drawing.
  const ids = [...new Set(selected.flatMap((p) => p.memberIds ?? [p.id]))];

  async function make() {
    setBusy(true);
    setError(null);
    setResult(null);
    const made = new Set<string>();
    const skipped = new Map<string, string>();
    let left = ids;
    try {
      while (left.length) {
        const res = await fetch(`/api/systems/${systemId}/drawings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ partIds: left }),
        });
        const body = (await res.json()) as MakeSummary & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Couldn't make the drawings.");
        body.made.forEach((id) => made.add(id));
        body.skipped.forEach((s) => skipped.set(s.id, s.reason));
        if (body.left.length >= left.length) break; // no progress: stop rather than loop
        left = body.left;
      }
      const names = (id: string) => partTitle(selected.find((p) => (p.memberIds ?? [p.id]).includes(id)) ?? { displayName: null, onshapeName: null });
      setResult(
        `${made.size} drawing${made.size === 1 ? "" : "s"} ready` +
          (skipped.size ? ` · skipped ${[...skipped].map(([id, why]) => `${names(id)} (${why})`).join(", ")}` : ""),
      );
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-surface/95 p-3 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold tabular-nums">{selected.length} selected</span>
        <button className="btn" onClick={onSelectAll} disabled={busy || selected.length === total}>
          Select all
        </button>
        <button className="btn-primary" onClick={make} disabled={busy || ids.length === 0}>
          {busy ? "Making drawings…" : "Make drawings"}
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
