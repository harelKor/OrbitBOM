"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { BomGroup } from "@/lib/parts/bomGroups";
import type { CardPart } from "./types";

// The system page's group cards above the parts (Harel, 2026-11-21): Bearings, Screws, 3D prints,
// each sheet... A tap filters the list to that group; a card with sizes or thicknesses opens them.
// A grid on desktop, one sideways row on phones, so the parts list stays a short scroll away.
export function GroupCards({ groups, picked, onPick }: { groups: BomGroup<CardPart>[]; picked: string | null; onPick: (key: string | null) => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = openKey ? groups.find((g) => g.key === openKey && g.children) : undefined;
  const shown = open ? open.children! : groups;
  const lit = (g: BomGroup<CardPart>) => g.key === picked || (!open && !!g.children?.some((c) => c.key === picked));

  return (
    <section aria-label="Groups" className="space-y-1.5">
      {open && (
        <button
          onClick={() => {
            setOpenKey(null);
            onPick(null);
          }}
          className="press -ml-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1 text-sm font-semibold text-fg-2 hover:text-fg pointer-coarse:min-h-9"
        >
          <Icon name="chevron" className="h-4 w-4 rotate-180" />
          {open.name}
        </button>
      )}
      {/* Keyed by the open card so a drill in or out starts the phone row at its first card. */}
      <div key={openKey ?? ""} className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-2 max-md:-mx-4 max-md:flex max-md:snap-x max-md:overflow-x-auto max-md:px-4 max-md:pb-1 max-md:[scrollbar-width:none]">
        {shown.map((g) => (
          <div key={g.key} className="relative max-md:w-52 max-md:shrink-0 max-md:snap-start">
            <button
              onClick={() => {
                if (g.children && !open) {
                  setOpenKey(g.key);
                  onPick(g.key);
                } else onPick(lit(g) ? (open ? open.key : null) : g.key);
              }}
              data-selected={lit(g)}
              className="card-interactive group flex w-full items-center gap-3 p-2 text-left"
            >
              <Collage parts={g.parts} />
              <span className="min-w-0 flex-1">
                <span className="display line-clamp-2 text-lg leading-tight break-words text-fg">{g.name}</span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-subtle tabular-nums">
                  {g.parts.length} {g.parts.length === 1 ? "part" : "parts"} · {g.pieces} pcs
                  {g.children && !open && <Icon name="chevron" className="ml-auto h-3.5 w-3.5 text-muted" />}
                </span>
              </span>
            </button>
            {lit(g) && (
              <button
                onClick={() => onPick(open && g.key !== open.key ? open.key : null)}
                aria-label={`Show every part, not just ${g.name}`}
                className="press absolute -top-1.5 -right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-white shadow pointer-coarse:h-8 pointer-coarse:w-8"
              >
                <Icon name="close" className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// Up to four of the group's own part pictures, 2×2 (one picture fills the square).
function Collage({ parts }: { parts: CardPart[] }) {
  const seen = new Set<string>();
  const pics: string[] = [];
  for (const p of parts) {
    if (pics.length === 4) break;
    if (p.thumbUrl && !seen.has(p.thumbUrl)) {
      seen.add(p.thumbUrl);
      pics.push(p.thumbUrl);
    }
  }
  const one = pics.length === 1;
  return (
    <span className={`thumb-well grid h-14 w-14 shrink-0 gap-px rounded-lg ${one ? "" : "grid-cols-2 grid-rows-2"}`}>
      {(one ? pics : [0, 1, 2, 3].map((i) => pics[i])).map((src, i) =>
        src ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
          <img key={i} src={src} alt="" loading="lazy" className="thumb-edge h-full w-full object-contain p-0.5" />
        ) : (
          <span key={i} />
        ),
      )}
    </span>
  );
}
