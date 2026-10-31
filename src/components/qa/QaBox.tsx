"use client";

import Link from "next/link";
import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { CheckIcon } from "@/components/ui/CheckBadge";
import { Icon } from "@/components/ui/Icon";

export type QaSystem = { id: string; name: string; count: number };

// The robot dashboard's Ready for QA box. A click opens the systems that have parts to QA; a
// system goes to its page, where they wait at the top.
export function QaBox({ robotId, systems }: { robotId: string; systems: QaSystem[] }) {
  const [open, setOpen] = useState(false);
  const total = systems.reduce((n, s) => n + s.count, 0);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="card-interactive group flex items-center gap-5 py-5 pr-8 pl-6 text-left active:scale-[0.98] sm:gap-8 sm:pr-12 sm:pl-7">
        <span className="flex h-12 w-12 shrink-0 sm:h-14 sm:w-14 items-center justify-center rounded-full border-2 border-amber-500/60 bg-amber-500/10 text-amber-500">
          <CheckIcon className="h-6 w-6 sm:h-7 sm:w-7" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-bold text-fg sm:text-xl">Ready for QA</span>
          <span className="mt-0.5 block text-sm text-subtle tabular-nums">
            {total === 0 ? "Nothing to check" : `in ${systems.length} ${systems.length === 1 ? "system" : "systems"}`}
          </span>
        </span>
        <span className="display font-mono text-5xl sm:text-6xl text-accent tabular-nums">{total}</span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Ready for QA" wide>
        {systems.length === 0 ? (
          <p className="text-sm text-muted">No parts are waiting for QA.</p>
        ) : (
          <ul className="space-y-2">
            {systems.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/robots/${robotId}/systems/${s.id}#qa`}
                  onClick={() => setOpen(false)}
                  className="card-interactive group flex items-center gap-3 px-4 py-3"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold">{s.name}</span>
                  <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono text-sm font-bold text-amber-500 tabular-nums">{s.count}</span>
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
