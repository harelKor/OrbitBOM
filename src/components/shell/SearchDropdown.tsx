"use client";

import { useEffect, useRef, useState } from "react";
import { openPartWindow } from "@/components/bom/PartDetailsHost";
import { useInventoryPopup } from "@/components/inventory/InventoryPopup";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatStock } from "@/lib/inventory/stock";
import type { SearchResults } from "@/lib/data/search";

type Hit = { kind: "part" | "item"; id: string };

// The top bar search's results (Harel, 2026-11-04): BOM parts by system, then inventory items by
// category, from every active robot and the whole shelf. Picking one opens its window over the
// page you're on. ↑ ↓ move, Enter opens, Escape closes. On a phone it's a short box, the full width
// under the search, holding every result: a finger scrolls it without moving the page.
export function SearchDropdown({ q, open, onClose, input }: { q: string; open: boolean; onClose: () => void; input: React.RefObject<HTMLInputElement | null> }) {
  const { openItem } = useInventoryPopup();
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const query = q.trim();

  // A short pause after typing, and the last search dropped once the text changes.
  useEffect(() => {
    if (query.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        if (res.ok) {
          setResults(await res.json());
          setActive(0);
        }
      } catch {}
      if (!ctrl.signal.aborted) setLoading(false);
    }, 180);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const hits: Hit[] = results
    ? [...results.bom.flatMap((s) => s.parts.map((p) => ({ kind: "part" as const, id: p.id }))), ...results.inventory.flatMap((s) => s.items.map((i) => ({ kind: "item" as const, id: i.id })))]
    : [];
  const pick = (h: Hit) => {
    onClose();
    input.current?.blur();
    if (h.kind === "part") void openPartWindow(h.id);
    else openItem(h.id);
  };

  // Keys arrive at the search box; the list follows them.
  useEffect(() => {
    const el = input.current;
    if (!el || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (!hits.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        pick(hits[Math.min(active, hits.length - 1)]);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    panel.current?.querySelector("[data-active=true]")?.scrollIntoView({ block: "nearest" });
  }, [active]);
  // A press anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !input.current?.contains(t)) onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, onClose, input]);

  if (!open || query.length < 2) return null;
  const empty = results && !results.bom.length && !results.inventory.length;
  let n = -1;
  const row = (h: Hit, content: React.ReactNode) => {
    n += 1;
    const i = n;
    return (
      <button
        key={`${h.kind}:${h.id}`}
        type="button"
        data-active={i === active}
        onMouseEnter={() => setActive(i)}
        onClick={() => pick(h)}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left data-[active=true]:bg-accent/15"
      >
        {content}
      </button>
    );
  };
  const thumb = (url: string | null) => (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links
        <img src={url} alt="" className="h-full w-full object-contain p-0.5" />
      ) : (
        <Icon name="box" className="h-4 w-4 text-slate-400" />
      )}
    </span>
  );
  const heading = (icon: "cube" | "box", text: React.ReactNode, more: number) => (
    <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">
      <Icon name={icon} className="h-3.5 w-3.5" />
      <span className="min-w-0 truncate">{text}</span>
      {more > 0 && <span className="ml-auto shrink-0 font-normal normal-case tabular-nums">+{more} more</span>}
    </div>
  );

  return (
    <div
      ref={panel}
      role="listbox"
      className="absolute top-full left-0 z-50 mt-1.5 max-h-[min(70vh,40rem)] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-line-strong bg-surface p-1.5 text-fg shadow-2xl [-webkit-overflow-scrolling:touch] max-md:right-0 max-md:max-h-[min(45vh,20rem)] max-md:w-auto"
    >
      {!results && loading && <p className="px-2 py-3 text-sm text-subtle">Searching…</p>}
      {empty && <p className="px-2 py-3 text-sm text-subtle">Nothing on the BOM or the shelf matches “{query}”.</p>}
      {results && results.bom.length > 0 && (
        <div className="px-2 pt-1 text-xs font-bold text-muted">BOM</div>
      )}
      {results?.bom.map((s) => (
        <section key={s.systemId}>
          {heading("cube", `${s.systemName} · ${s.robotName}`, s.more)}
          {s.parts.map((p) =>
            row(
              { kind: "part", id: p.id },
              <>
                {thumb(p.thumbUrl)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.name}</span>
                  {p.partNumber && <span className="block truncate text-xs text-subtle tabular-nums">{p.partNumber}</span>}
                </span>
                <StatusPill status={p.status} size="sm" />
              </>,
            ),
          )}
        </section>
      ))}
      {results && results.inventory.length > 0 && (
        <div className={`px-2 pt-1 text-xs font-bold text-muted ${results.bom.length ? "mt-1 border-t border-line pt-2" : ""}`}>Inventory</div>
      )}
      {results?.inventory.map((s) => (
        <section key={s.category}>
          {heading("box", s.label, s.more)}
          {s.items.map((it) =>
            row(
              { kind: "item", id: it.id },
              <>
                {thumb(it.thumbUrl)}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{it.name}</span>
                <span className="shrink-0 text-xs text-muted tabular-nums">{formatStock(it.inStock)} on the shelf</span>
              </>,
            ),
          )}
        </section>
      ))}
    </div>
  );
}
