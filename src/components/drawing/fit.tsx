"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fitTargets } from "@/app/(app)/inventory/actions";
import { openPartWindow } from "@/components/bom/PartDetailsHost";
import { useInventoryPopup } from "@/components/inventory/InventoryPopup";
import type { FitPart } from "@/lib/drawing/download";

// What a fit note can fit: a part of the system or any inventory item (Harel, 2026-10-31).
export type FitTarget = { kind: "part" | "item"; id: string; name: string; thumbUrl: string | null; category?: string };
type Items = Awaited<ReturnType<typeof fitTargets>>;

// Every inventory item's name and picture, loaded once per page for the picker and the notes.
let cache: Promise<Items> | null = null;
export function useFitItems(): Items | null {
  const [items, setItems] = useState<Items | null>(null);
  useEffect(() => {
    let live = true;
    cache ??= fitTargets().catch((e) => {
      cache = null;
      throw e;
    });
    cache.then((r) => live && setItems(r)).catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, []);
  return items;
}

// The names notes are matched against: the system's parts, then inventory items.
export function linkTargets(parts: FitPart[], items: Items | null) {
  return [...parts.map((p) => ({ name: p.name, partId: p.id })), ...(items ?? []).map((i) => ({ name: i.name, itemId: i.id }))];
}

// A click on a linked note opens its part's or item's window on top of the drawing. `fromTarget`
// reads the note from the clicked SVG element (svg.ts marks it .fit-link) and says whether the
// click was on one.
export function useOpenFitLink() {
  const { openItem } = useInventoryPopup();
  const open = (link: { partId?: string; itemId?: string }) => {
    if (link.partId) void openPartWindow(link.partId).then((ok) => !ok && alert("Couldn't open that part."));
    else if (link.itemId) openItem(link.itemId);
  };
  const fromTarget = (target: EventTarget | null) => {
    const g = target instanceof Element ? target.closest(".fit-link") : null;
    if (!g) return false;
    open({ partId: g.getAttribute("data-fit-part") ?? undefined, itemId: g.getAttribute("data-fit-item") ?? undefined });
    return true;
  };
  return { open, fromTarget };
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (name: string, ws: string[]) => {
  const n = name.toLowerCase();
  return ws.every((w) => n.includes(w));
};

// One search for a fit's other side, with pictures: before typing, the system's parts and the
// inventory's bearings; typing searches the parts and the whole inventory.
export function FitPicker({ parts, value, onPick }: { parts: FitPart[]; value: FitTarget | null; onPick: (t: FitTarget | null) => void }) {
  const items = useFitItems();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  // The results list stays closed until the search box is focused, and closes on a pick or an outside click.
  const [listOpen, setListOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!listOpen) return;
    const onDown = (e: PointerEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      setListOpen(false);
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [listOpen]);
  const rows = useMemo<FitTarget[]>(() => {
    const ws = words(q);
    const ps: FitTarget[] = parts.filter((p) => matches(p.name, ws)).map((p) => ({ kind: "part", id: p.id, name: p.name, thumbUrl: p.thumbUrl }));
    const is: FitTarget[] = (items ?? [])
      .filter((i) => (ws.length ? matches(i.name, ws) : i.category === "bearings"))
      .map((i) => ({ kind: "item", id: i.id, name: i.name, thumbUrl: i.thumbUrl, category: i.category }));
    // Typing: bearings first, the likeliest fit, then parts, then the rest of the inventory.
    return ws.length ? [...is.filter((i) => i.category === "bearings"), ...ps, ...is.filter((i) => i.category !== "bearings")].slice(0, 60) : [...ps, ...is];
  }, [q, parts, items]);

  if (value && !open)
    return (
      <div className="flex items-center gap-2 rounded-lg border border-sky-400/40 bg-sky-500/10 p-1.5">
        <Thumb url={value.thumbUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium" title={value.name}>
            {value.name}
          </span>
          <Badge t={value} />
        </span>
        <button className="btn py-0.5 text-xs active:scale-[0.98]" onClick={() => setOpen(true)}>
          Change
        </button>
      </div>
    );

  return (
    <div ref={boxRef} className="space-y-1">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setListOpen(true);
        }}
        onFocus={() => setListOpen(true)}
        onClick={() => setListOpen(true)}
        autoFocus={!!value}
        className="input w-full text-sm"
        placeholder="Search parts and inventory"
        aria-label="Fit for"
        onKeyDown={(e) => {
          if (e.key === "Enter" && rows[0]) {
            onPick(rows[0]);
            setOpen(false);
            setListOpen(false);
            setQ("");
          }
          if (e.key === "Escape" && (value || listOpen)) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            setListOpen(false);
          }
        }}
      />
      {listOpen && (
      <div className="max-h-72 overflow-auto rounded-lg border border-white/10 bg-[#07090E]/60">
        {rows.map((t) => (
          <button
            key={`${t.kind}:${t.id}`}
            onClick={() => {
              onPick(t);
              setOpen(false);
              setListOpen(false);
              setQ("");
            }}
            className={`flex w-full items-center gap-2 px-1.5 py-1 text-left transition-colors duration-150 hover:bg-white/10 active:scale-[0.98] ${value?.id === t.id ? "bg-sky-500/20" : ""}`}
          >
            <Thumb url={t.thumbUrl} />
            <span className="min-w-0 flex-1 truncate text-xs" title={t.name}>
              {t.name}
            </span>
            <Badge t={t} />
          </button>
        ))}
        {!rows.length && <p className="px-2 py-2 text-xs text-white/50">{items ? "Nothing matches." : "Loading…"}</p>}
        {!q && items && <p className="px-2 py-1.5 text-[11px] text-white/40">Type to search the whole inventory.</p>}
      </div>
      )}
    </div>
  );
}

function Thumb({ url }: { url: string | null }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gradient-to-b from-white to-slate-100">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed R2 thumbnails */}
      {url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-contain" /> : <span className="text-[10px] text-slate-400">—</span>}
    </span>
  );
}

function Badge({ t }: { t: FitTarget }) {
  const [label, cls] =
    t.kind === "part" ? ["Part", "bg-sky-500/15 text-sky-300"] : t.category === "bearings" ? ["Bearing", "bg-amber-500/15 text-amber-300"] : ["Inventory", "bg-white/10 text-white/60"];
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>;
}
