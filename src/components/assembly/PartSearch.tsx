"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { AssemblyPart } from "@/lib/data/assembly";

// Adding parts to a step (Harel, 2026-11-10): a search over every part of the system, COTS
// included, with a dropdown of results and their pictures like the top bar's search. A pick adds or
// removes the part and keeps the list open for the next one. ↑ ↓ move, Enter picks, Escape closes.
// Matches every word typed against the name and part number.
export function PartSearch({ parts, picked, usedIn, onToggle }: { parts: AssemblyPart[]; picked: Set<string>; usedIn: Map<string, number>; onToggle: (key: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length
    ? parts
        .filter((p) => {
          const text = `${p.name} ${p.number ?? ""}`.toLowerCase();
          return words.every((w) => text.includes(w));
        })
        .slice(0, 60)
    : [];

  useEffect(() => {
    panel.current?.querySelector("[data-active=true]")?.scrollIntoView({ block: "nearest" });
  }, [active]);
  // A press anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !input.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation(); // the window stays open
      return setOpen(false);
    }
    if (!hits.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onToggle(hits[Math.min(active, hits.length - 1)].key);
    }
  };

  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle">
        <Icon name="search" className="h-4 w-4" />
      </span>
      <input
        ref={input}
        className="input w-full pl-8"
        value={q}
        placeholder="Search this system's parts (COTS too)"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        role="combobox"
        aria-controls={listId}
        aria-expanded={open && words.length > 0}
      />
      {open && words.length > 0 && (
        <div
          ref={panel}
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1.5 max-h-[min(50vh,24rem)] overflow-y-auto overscroll-contain rounded-xl border border-line-strong bg-surface p-1.5 text-fg shadow-2xl"
        >
          {!hits.length && <p className="px-2 py-3 text-sm text-subtle">No part in this system matches “{q.trim()}”.</p>}
          {hits.map((p, i) => {
            const on = picked.has(p.key);
            const step = usedIn.get(p.key);
            return (
              <button
                key={p.key}
                type="button"
                role="option"
                aria-selected={on}
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onToggle(p.key);
                  input.current?.focus();
                }}
                className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left data-[active=true]:bg-accent/15 pointer-coarse:min-h-12"
              >
                <Thumb url={p.thumbUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.name}</span>
                  <span className="block truncate text-xs text-subtle tabular-nums">
                    {[p.number, `×${p.qty}`, step ? `in step ${step}` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {p.cots && <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">COTS</span>}
                {!p.key.startsWith("id:") ? null : <span className="shrink-0 text-[10px] text-subtle" title="Not placed in the 3D model: listed with the step, not drawn">no 3D</span>}
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${on ? "border-accent bg-accent text-white" : "border-line-strong text-muted"}`}>{on ? "✓" : "+"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// A part's picture on white, like the top bar's search.
export function Thumb({ url, small = false }: { url: string | null; small?: boolean }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ${small ? "h-7 w-7" : "h-9 w-9"}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links
        <img src={url} alt="" className="h-full w-full object-contain p-0.5" loading="lazy" />
      ) : (
        <Icon name="box" className="h-4 w-4 text-slate-400" />
      )}
    </span>
  );
}
