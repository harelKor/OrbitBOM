"use client";

import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Icon } from "@/components/ui/Icon";
import { ShopMap, type PlaceStats } from "@/components/map/ShopMap";
import { placeIndex, placeWord, zoneColor, zoneOf } from "@/lib/inventory/places";
import type { Location } from "./types";

// Picking an item's place anywhere (item window, item form, table row, bulk Move) opens the shop
// map in pick mode: tap a zone, or step into its picture and tap a drawer (Harel, 2026-11-14).
// Places have no names on screen: the button shows the zone's colour and what kind of place it
// is. `choices` adds plain options such as "No place"; `readOnly` only shows where it is.
export function LocationPicker({
  locations,
  value,
  onChange,
  choices,
  disabled = false,
  className,
  style,
  children,
  ariaLabel = "Place on the shop map",
  readOnly = false,
  footer,
  onClick,
  stats,
}: {
  locations: Location[];
  value: string | null;
  onChange?: (id: string | null) => void;
  choices?: { value: string | null; label: string }[];
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  ariaLabel?: string;
  readOnly?: boolean;
  footer?: (close: () => void) => React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  stats?: PlaceStats;
}) {
  const [open, setOpen] = useState(false);
  const byId = placeIndex(locations);
  const current = value ? byId.get(value) : undefined;
  const pick = (id: string | null) => {
    setOpen(false);
    if (id !== value) onChange?.(id);
  };
  const extra = readOnly ? [] : (choices ?? (value ? [{ value: null, label: "No place" }] : []));
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          onClick?.(e);
          setOpen(true);
        }}
        aria-label={ariaLabel}
        title={readOnly ? "Show on the shop map" : "Choose on the shop map"}
        className={className ?? "input flex min-h-11 items-center gap-2 text-left active:scale-[0.98]"}
        style={style}
      >
        {children ?? <PlaceChip place={current} zoneColorOf={(id) => zoneColor(zoneOf(id, byId))} />}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        width="w-[min(60rem,calc(100vw-1rem))]"
        title={readOnly ? "Where it is" : "Choose a place"}
      >
        {open && (
          <div className="space-y-3">
            <ShopMap
              places={locations}
              stats={stats}
              mode={readOnly ? "browse" : "pick"}
              selectedId={value}
              find={value}
              onPick={readOnly ? undefined : pick}
              className="h-[min(68dvh,36rem,130vw)] w-full"
            />
            {extra.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {extra.map((c) => (
                  <button key={c.label} type="button" onClick={() => pick(c.value)} className="btn min-h-9 text-xs active:scale-[0.98]">
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            {footer?.(() => setOpen(false))}
          </div>
        )}
      </Dialog>
    </>
  );
}

// A place without its name: the map icon, the zone's colour and "Drawer" / "Zone".
export function PlaceChip({ place, zoneColorOf }: { place: Location | undefined; zoneColorOf: (id: string) => string }) {
  return (
    <>
      <Icon name="map" className="h-4 w-4 shrink-0 text-accent" />
      {place && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: zoneColorOf(place.id) }} />}
      <span className={place ? "" : "text-muted"}>{place ? placeWord(place) : "Choose on the map"}</span>
    </>
  );
}

// The same inline, for rows and table cells.
export function PlaceTag({ place, places, suffix }: { place: Location | null | undefined; places: Location[]; suffix?: string }) {
  const byId = placeIndex(places);
  return (
    <span className="inline-flex items-center gap-1.5">
      <PlaceChip place={place ?? undefined} zoneColorOf={(id) => zoneColor(zoneOf(id, byId))} />
      {suffix && <span className="text-muted">{suffix}</span>}
    </span>
  );
}
