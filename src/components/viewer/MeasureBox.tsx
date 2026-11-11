"use client";

import { toast } from "@/components/ui/Toaster";
import { formatRow } from "@/lib/model/measure";
import type { MeasureInfo } from "./measureLayer";
import { UnitsSwitch, useUnits } from "./units";

// Onshape's measure box, bottom right of the 3D view (bigger since 2026-11-11, Harel): what's
// picked, then its size, or between two picks the minimum and maximum distance, ΔX / ΔY / ΔZ and
// the angle (src/lib/model/measure.ts). Each value has a copy button, like Onshape's. Shared by the
// CAD page and the /dev/viewer sandbox; `className` places it (above + Add comment on a phone).
// Lengths in mm or inches (the switch at the top, kept per browser, like Onshape's units; S9).
export function MeasureBox({ measured, className = "bottom-3" }: { measured: MeasureInfo; className?: string }) {
  const units = useUnits();
  if (!measured.picks.length) return null;
  // The number as shown, without the "≈" that marks a value read off the tessellation.
  const copy = (label: string, value: string) =>
    void navigator.clipboard.writeText(value.replace(/^≈\s*/, "")).then(
      () => toast(`${label} copied`),
      () => toast("Couldn't copy it", true),
    );
  return (
    <div className={`absolute right-3 z-20 w-80 max-w-[calc(100%-1.5rem)] animate-pop rounded-md border border-line bg-surface/95 p-3 text-sm shadow-md backdrop-blur ${className}`}>
      <UnitsSwitch className="float-right -mt-1 -mr-1 ml-2" />
      <ul className="max-h-36 space-y-0.5 overflow-y-auto">
        {measured.picks.map((p, k) => (
          <li key={k} className="flex items-center gap-1.5 text-fg-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#ff8a1f]" />
            <span className="truncate">{p}</span>
          </li>
        ))}
      </ul>
      <table className="mt-1.5 w-full tabular-nums">
        <tbody>
          {measured.rows.map((r) => ({ ...r, value: formatRow(r, units) })).map((r) => (
            <tr key={r.label} className="border-t border-line">
              <td className="py-1.5 pr-2 text-muted">{r.label}</td>
              <td className="py-1.5 text-right text-lg font-bold whitespace-nowrap text-fg">{r.value}</td>
              <td className="w-8 py-1 pl-1 text-right">
                <button
                  className="press inline-flex size-7 items-center justify-center rounded text-subtle hover:bg-raised hover:text-fg active:scale-[0.98] pointer-coarse:size-9"
                  title={`Copy the ${r.label.toLowerCase()}`}
                  aria-label={`Copy ${r.label}`}
                  onClick={() => copy(r.label, r.value)}
                >
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                    <path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3.5V9A1.5 1.5 0 0 0 4 10.5h1.5" />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {measured.picks.length === 1 && <p className="mt-1 text-xs text-subtle">Pick a second one to measure between them.</p>}
      {measured.picks.length > 2 && <p className="mt-1 text-xs text-subtle">Measures show for one or two picks. Space drops the newest, Esc all.</p>}
    </div>
  );
}
