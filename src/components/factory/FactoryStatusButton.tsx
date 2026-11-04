"use client";

import { useState } from "react";
import type { FabArea } from "@/config/machines";
import { getStatus, statusLabel } from "@/config/statuses";
import { StatusNoteDialog } from "@/components/bom/fields";
import { textOn } from "@/components/bom/options";
import { Popover } from "@/components/bom/Popover";
import { ReleaseChecklist } from "@/components/bom/ReleaseBar";
import type { CardPart } from "@/components/bom/types";
import { useCan, useMode } from "@/components/shell/ModeContext";
import { NOTE_STATUSES, RELEASE_STATUS, pickableStatuses } from "@/components/shell/mode";

// Factory Fab's and 3D Printing's big status button, like the Order List's: one wide coloured
// button, and a menu of big buttons for the statuses this team may set there, named as the machine
// calls them (Sliced, Printing on a printer). On a pack it sets every part; `status` null there
// means its parts differ (Mixed). The CAD Team works printer parts too (Harel, 2026-11-04): its
// Released goes through the Release checklist, and Reproduction asks why, on one part only
// (`part`), as the card's status menu does. On factory parts it changes nothing here.
export function FactoryStatusButton({
  status,
  onPick,
  area,
  machine,
  part,
  count = 1,
  compact = false,
}: {
  status: string | null;
  onPick: (status: string, note?: string) => void;
  area: FabArea;
  machine: string;
  part?: CardPart; // a single part's button, so Reproduction's reason can join its note
  count?: number; // how many parts the button sets (the checklist's count)
  compact?: boolean;
}) {
  const { mode } = useMode();
  const cad = mode === "cad";
  const options = (cad && area === "factory" ? [] : (pickableStatuses(mode, area) ?? [])).filter((s) => !(cad && NOTE_STATUSES.includes(s) && !part));
  const locked = !useCan("work") || !options.length;
  const [checking, setChecking] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const color = (status && getStatus(status)?.color) || "#cbd5e1";
  const option = "press flex w-full items-center justify-center rounded-xl border-2 border-black/25 py-3 text-base font-bold shadow-sm";
  const pick = (s: string) => {
    if (s === status) return;
    if (cad && s === RELEASE_STATUS) setChecking(true);
    else if (cad && NOTE_STATUSES.includes(s)) setAsking(s);
    else onPick(s);
  };
  return (
    <>
      <Popover
        locked={locked}
        hideCaret
        triggerClassName={compact ? "" : "w-full"}
        trigger={
          <span
            className={`flex items-center justify-center gap-2 border-2 border-black/20 font-bold shadow-sm ${compact ? "rounded-full px-3 py-1 text-xs" : "w-full rounded-xl py-2.5 text-base"}`}
            style={{ background: color, color: textOn(color) }}
          >
            {status ? statusLabel(status, machine) : "Mixed"}
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
                    pick(s);
                    close();
                  }}
                  className={`${option} ${s === status ? "ring-2 ring-fg/50 ring-offset-1" : ""}`}
                  style={{ background: c, color: textOn(c) }}
                >
                  {statusLabel(s, machine)}
                </button>
              );
            })}
          </div>
        )}
      </Popover>
      {checking && (
        <ReleaseChecklist
          count={count}
          onClose={() => setChecking(false)}
          onConfirm={() => {
            setChecking(false);
            onPick(RELEASE_STATUS);
          }}
        />
      )}
      {asking && part && (
        <StatusNoteDialog
          part={part}
          status={asking}
          onClose={() => setAsking(null)}
          onConfirm={(reason) => {
            const line = `${asking}: ${reason}`;
            onPick(asking, (part.note?.trim() ? `${part.note.trim()}\n\n${line}` : line).slice(-2000));
            setAsking(null);
          }}
        />
      )}
    </>
  );
}
