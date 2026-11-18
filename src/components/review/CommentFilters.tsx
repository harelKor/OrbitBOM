"use client";

import { Popover } from "@/components/bom/Popover";
import { STATE_FILTERS, statusOf, type StateFilter } from "@/lib/reviews/status";

// The comments column's header buttons (Harel, 2026-11-18): small dropdowns on the "Comments" line.
const TRIGGER =
  "press flex h-7 items-center gap-1 rounded-md border border-line bg-surface px-2 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg active:scale-[0.98] pointer-coarse:h-9";

export function StateFilterMenu({ value, onChange }: { value: StateFilter; onChange: (v: StateFilter) => void }) {
  const now = STATE_FILTERS.find((f) => f.key === value) ?? STATE_FILTERS[0];
  return (
    <Popover
      align="right"
      hideCaret
      width={170}
      triggerClassName={TRIGGER}
      trigger={
        <span className="flex items-center gap-1" title="Which comments the list shows" aria-label={`State filter: ${now.label}`}>
          <FunnelIcon />
          {/* Phones: just the icon, so "Comments" keeps its room. */}
          <span className="max-sm:hidden">{value === "active" ? "State" : now.label}</span>
          <span aria-hidden className="text-subtle">▾</span>
        </span>
      }
    >
      {(close) => (
        <ul className="text-sm" role="listbox" aria-label="State filter">
          {STATE_FILTERS.map((f) => (
            <li key={f.key}>
              <button
                type="button"
                role="option"
                aria-selected={f.key === value}
                onClick={() => {
                  close();
                  onChange(f.key);
                }}
                className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-raised active:scale-[0.98] ${f.key === value ? "font-semibold text-fg" : "text-fg-2"}`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: f.key === "active" || f.key === "all" ? "transparent" : statusOf(f.key).color, boxShadow: f.key === "active" || f.key === "all" ? "inset 0 0 0 1.5px currentColor" : undefined }} />
                <span className="flex-1">{f.label}</span>
                {f.key === value && <span aria-hidden>✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

export function FunnelIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M2.5 3h11l-4.2 5.2v4.3l-2.6 1.2V8.2z" strokeLinejoin="round" />
    </svg>
  );
}
