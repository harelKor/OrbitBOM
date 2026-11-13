"use client";

import { Popover } from "@/components/bom/Popover";
import { Icon } from "./Icon";

// Cards / List / Table (/ Kanban) as a dropdown at a toolbar's right end, instead of a segmented
// box; tinted with the accent so it's easy to spot (Harel, 2026-11-13).
export function ViewPicker<T extends string>({ options, value, onChange, label = "View" }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label?: string }) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <Popover
      align="right"
      width={160}
      hideCaret
      triggerClassName="inline-flex min-h-10 items-center gap-2 rounded-lg border border-accent/60 bg-accent/10 px-3.5 text-sm font-semibold text-fg shadow-sm hover:border-accent hover:bg-accent/20 active:scale-[0.98]"
      trigger={
        <span aria-label={`${label}: ${current.label}`} className="inline-flex items-center gap-2">
          <Icon name="list" className="h-4 w-4 text-accent" />
          {current.label}
          <Icon name="chevron" className="h-3.5 w-3.5 rotate-90 text-accent" />
        </span>
      }
    >
      {(close) => (
        <div role="menu" aria-label={label} className="p-1">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              onClick={() => {
                if (o.value !== value) onChange(o.value);
                close();
              }}
              className={`press flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm pointer-coarse:min-h-9 ${o.value === value ? "bg-raised font-semibold text-fg" : "text-fg-2 hover:bg-raised hover:text-fg"}`}
            >
              {o.label}
              {o.value === value && <span aria-hidden className="text-accent">✓</span>}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
