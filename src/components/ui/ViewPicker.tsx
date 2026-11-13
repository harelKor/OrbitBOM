"use client";

import { Popover } from "@/components/bom/Popover";
import { Icon } from "./Icon";

// Cards / List / Table as a small dropdown at a page's top right, instead of a wide segmented box
// (Harel, 2026-11-13).
export function ViewPicker<T extends string>({ options, value, onChange, label = "View" }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label?: string }) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <Popover
      align="right"
      width={160}
      hideCaret
      triggerClassName="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-raised px-2.5 text-xs font-semibold text-fg-2 hover:text-fg active:scale-[0.98]"
      trigger={
        <span aria-label={`${label}: ${current.label}`} className="inline-flex items-center gap-1.5">
          <Icon name="list" className="h-3.5 w-3.5 text-subtle" />
          {current.label}
          <Icon name="chevron" className="h-3 w-3 rotate-90 text-subtle" />
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
