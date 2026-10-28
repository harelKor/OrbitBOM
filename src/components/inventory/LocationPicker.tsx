"use client";

import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import type { Location } from "./types";
import { WorkshopMap } from "./WorkshopMap";

// Picking an item's location anywhere (item window, item form, table row, bulk Move) opens a
// small window with the workshop map: tap a pin and it's chosen (Harel, 2026-10-28). Locations
// that aren't on the map are pills under it; `choices` adds plain options such as "No location".
export function LocationPicker({
  locations,
  value,
  onChange,
  choices,
  disabled = false,
  className,
  style,
  children,
  ariaLabel = "Location",
}: {
  locations: Location[];
  value: string | null;
  onChange: (id: string | null) => void;
  choices?: { value: string | null; label: string }[];
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = locations.find((l) => l.id === value);
  const pick = (id: string | null) => {
    setOpen(false);
    if (id !== value) onChange(id);
  };
  const extra = choices ?? (value ? [{ value: null, label: "No location" }] : []);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={ariaLabel}
        title="Choose on the workshop map"
        className={className ?? "input min-h-11 text-left active:scale-[0.98]"}
        style={style}
      >
        {children ?? (current ? `📍 ${current.name}` : "📍 Add location")}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        width="w-[min(46rem,calc(100vw-2rem))]"
        title={current ? `Location: ${current.name}` : "Choose a location"}
      >
        {open && (
          <div className="space-y-3">
            <WorkshopMap locations={locations} selectedId={value ?? undefined} onPick={pick} />
            {extra.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {extra.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => pick(c.value)}
                    className="btn min-h-9 text-xs active:scale-[0.98]"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
