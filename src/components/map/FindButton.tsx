"use client";

import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Icon } from "@/components/ui/Icon";
import type { Place } from "@/lib/inventory/places";
import { ShopMap, type PlaceStats } from "./ShopMap";

// The small map icon (no text) on an item or a part (Harel, 2026-11-14): opens the shop map and
// flies from the whole floor plan to the zone, into its picture, to the drawer, in 2 seconds.
export function FindButton({
  places,
  placeId,
  stats,
  onFilter,
  footer,
  title = "Where is it?",
  className = "press flex h-7 w-7 items-center justify-center rounded-md text-accent hover:bg-accent/10 active:scale-[0.98] pointer-coarse:h-9 pointer-coarse:w-9",
}: {
  // Left out, they're fetched when the window opens (pages that don't carry them).
  places?: Place[];
  placeId: string | null | undefined;
  stats?: PlaceStats;
  onFilter?: (id: string) => void;
  footer?: (close: () => void) => React.ReactNode;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const [fetched, setFetched] = useState<Place[] | null>(null);
  const shown = places ?? fetched;
  if (!placeId) return null;
  return (
    <>
      <button
        type="button"
        aria-label={title}
        title={title}
        className={className}
        onClick={(e) => {
          e.stopPropagation();
          setKey((k) => k + 1);
          setOpen(true);
          if (!places && !fetched)
            void fetch("/api/places")
              .then((r) => (r.ok ? r.json() : null))
              .then((a: { places: Place[] } | null) => setFetched(a?.places ?? []))
              .catch(() => setFetched([]));
        }}
      >
        <Icon name="map" className="h-4 w-4" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} width="w-[min(60rem,calc(100vw-1rem))]" title={title}>
        {open && !shown && <div className="h-[min(68dvh,36rem,130vw)] w-full animate-pulse rounded-xl bg-[#070B14]" />}
        {open && shown && (
          <div className="space-y-3">
            <ShopMap
              places={shown}
              stats={stats}
              find={placeId}
              findKey={key}
              selectedId={placeId}
              onFilter={
                onFilter &&
                ((id) => {
                  setOpen(false);
                  onFilter(id);
                })
              }
              className="h-[min(68dvh,36rem,130vw)] w-full"
            />
            {footer?.(() => setOpen(false))}
          </div>
        )}
      </Dialog>
    </>
  );
}
