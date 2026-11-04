"use client";

import { getStatus } from "@/config/statuses";
import { textOn } from "@/components/bom/options";
import { Popover } from "@/components/bom/Popover";
import { useCan, useMode } from "@/components/shell/ModeContext";
import { pickableStatuses } from "@/components/shell/mode";

// Factory Fab's big status button, like the Order List's: one wide coloured button, and a menu of
// big buttons for the factory statuses this team may set. On a pack it sets every part; `status`
// null there means its parts differ (Mixed).
export function FactoryStatusButton({ status, onPick, compact = false }: { status: string | null; onPick: (status: string) => void; compact?: boolean }) {
  const { mode } = useMode();
  // The CAD Team releases parts from the BOM, through the Release checklist, not here.
  const options = mode === "cad" ? [] : (pickableStatuses(mode, true) ?? []);
  const locked = !useCan("work") || !options.length;
  const color = (status && getStatus(status)?.color) || "#cbd5e1";
  const option = "press flex w-full items-center justify-center rounded-xl border-2 border-black/25 py-3 text-base font-bold shadow-sm";
  return (
    <Popover
      locked={locked}
      hideCaret
      triggerClassName={compact ? "" : "w-full"}
      trigger={
        <span
          className={`flex items-center justify-center gap-2 border-2 border-black/20 font-bold shadow-sm ${compact ? "rounded-full px-3 py-1 text-xs" : "w-full rounded-xl py-2.5 text-base"}`}
          style={{ background: color, color: textOn(color) }}
        >
          {status ?? "Mixed"}
          {!locked && <span className="text-xs opacity-70">▾</span>}
        </span>
      }
    >
      {(close) => (
        <div className="min-w-48 space-y-1.5 p-1">
          {options.map((s) => {
            const c = getStatus(s)?.color ?? "#cbd5e1";
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  if (s !== status) onPick(s);
                  close();
                }}
                className={`${option} ${s === status ? "ring-2 ring-fg/50 ring-offset-1" : ""}`}
                style={{ background: c, color: textOn(c) }}
              >
                {s}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}
