"use client";

import { useMemo, useState } from "react";
import { insertFromShelf } from "../insert-actions";

type Item = { id: string; name: string; category: string | null; thumb: string | null };

// The shelf's library parts with a search; tap to pick, Insert puts them in (newest version of
// each item's Onshape document).
export function ShelfList({ query, readOnly, items }: { query: string; readOnly: boolean; items: Item[] }) {
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; skipped?: string[] } | null>(null);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((i) => words.every((w) => `${i.name} ${i.category ?? ""}`.toLowerCase().includes(w)));
  }, [items, q]);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  async function insert() {
    setBusy(true);
    setResult(null);
    const r = await insertFromShelf(query, chosen).catch(() => ({ error: "Insert failed. Try again.", message: undefined, skipped: [] }));
    setBusy(false);
    setResult(r.error ? { ok: false, text: [r.message, r.error].filter(Boolean).join(" "), skipped: r.skipped } : { ok: true, text: r.message ?? "Inserted.", skipped: r.skipped });
    if (!r.error) setChosen([]);
  }
  return (
    <div className="flex flex-1 flex-col gap-2 p-3">
      <input className="input min-h-9 w-full" type="search" placeholder="Search the shelf" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the shelf" />
      {!items.length && <p className="text-muted">No inventory item has an Onshape part linked yet.</p>}
      <ul className="grid flex-1 grid-cols-1 content-start gap-1 min-[420px]:grid-cols-2">
        {shown.map((i) => {
          const on = chosen.includes(i.id);
          return (
            <li key={i.id}>
              <button type="button" onClick={() => toggle(i.id)} aria-pressed={on} className={`press flex min-h-12 w-full items-center gap-2 rounded-lg border p-1.5 text-left active:scale-[0.98] ${on ? "border-accent bg-accent/15" : "border-border bg-surface hover:bg-raised"}`}>
                {i.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.thumb} alt="" className="h-10 w-10 shrink-0 rounded bg-white object-contain" loading="lazy" />
                ) : (
                  <span className="h-10 w-10 shrink-0 rounded bg-raised" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg">{i.name}</span>
                  {i.category && <span className="block truncate text-xs text-muted">{i.category}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {result && (
        <div className={`rounded-lg border p-2 text-xs ${result.ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"} text-fg`} role="status">
          <p>{result.text}</p>
          {result.skipped?.length ? (
            <ul className="mt-1 list-disc pl-4 text-muted">
              {result.skipped.map((s) => (
                <li key={s}>Skipped {s}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {readOnly && <p className="text-xs text-amber-500">This tab is a version: open the workspace to insert.</p>}
      <div className="sticky bottom-0 flex items-center gap-2 bg-bg py-2">
        <span className="flex-1 text-xs text-muted tabular-nums">{chosen.length ? `${chosen.length} picked` : "Tap items to pick them."}</span>
        <button type="button" className="btn btn-primary min-h-9 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60" disabled={!chosen.length || busy || readOnly} onClick={() => void insert()}>
          {busy ? "Inserting…" : "Insert"}
        </button>
      </div>
    </div>
  );
}
