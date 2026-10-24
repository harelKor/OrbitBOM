"use client";

import Link from "next/link";
import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { CheckIcon } from "@/components/ui/CheckBadge";
import { Icon } from "@/components/ui/Icon";
import type { SystemSync } from "@/lib/versions/sync";

export type SyncSystem = { id: string; name: string } & SystemSync;

// The robot dashboard's Sync box, the QA box's other half (plan/system-versioning.md §7): which
// systems are Outdated and which have Onshape changes waiting. A click lists them; a system
// opens on its Versions window (Outdated) or its page (changes waiting).
export function SyncBox({ robotId, systems }: { robotId: string; systems: SyncSystem[] }) {
  const [open, setOpen] = useState(false);
  const outdated = systems.filter((s) => s.outdated).length;
  const waiting = systems.filter((s) => s.waiting > 0).length;
  const synced = outdated === 0 && waiting === 0;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="card-interactive group flex items-center gap-4 p-4 text-left">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 ${
            synced ? "border-sky-500/60 bg-sky-500/10 text-sky-500" : outdated ? "border-rose-500/60 bg-rose-500/10 text-rose-500" : "border-amber-500/60 bg-amber-500/10 text-amber-500"
          }`}
        >
          {synced ? <CheckIcon className="h-6 w-6" /> : <Icon name="box" className="h-6 w-6" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-muted">Onshape sync</span>
          {synced ? (
            <span className="block text-xs text-subtle">All systems up to date</span>
          ) : (
            <span className="block text-xs tabular-nums">
              {outdated > 0 && <span className="font-semibold text-rose-500">{outdated} outdated</span>}
              {outdated > 0 && waiting > 0 && <span className="text-subtle">, </span>}
              {waiting > 0 && <span className="font-semibold text-amber-500">{waiting} with changes waiting</span>}
            </span>
          )}
        </span>
        {!synced && <span className={`display font-mono text-4xl tabular-nums ${outdated ? "text-rose-500" : "text-amber-500"}`}>{outdated + waiting}</span>}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Onshape sync" wide>
        {synced ? (
          <p className="text-sm text-muted">Every system is on its latest version and nothing new is waiting in Onshape.</p>
        ) : (
          <ul className="space-y-2">
            {systems
              .filter((s) => s.outdated || s.waiting > 0)
              .map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/robots/${robotId}/systems/${s.id}${s.outdated ? "?versions=1" : ""}`}
                    onClick={() => setOpen(false)}
                    className="card-interactive group flex items-center gap-3 px-4 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{s.name}</span>
                      <span className="block text-xs text-subtle">
                        {s.outdated === "reverted" && "Reverted to an older version"}
                        {s.outdated === "partial" && "Some changed parts weren't committed"}
                        {s.outdated && s.waiting > 0 && " · "}
                        {s.waiting > 0 && `${s.waiting} ${s.waiting === 1 ? "change" : "changes"} waiting in Onshape`}
                      </span>
                    </span>
                    {s.outdated && <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-bold text-white">Outdated</span>}
                    {!s.outdated && s.waiting > 0 && (
                      <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono text-sm font-bold text-amber-500 tabular-nums">{s.waiting}</span>
                    )}
                    <Icon name="arrow" className="h-4 w-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}
