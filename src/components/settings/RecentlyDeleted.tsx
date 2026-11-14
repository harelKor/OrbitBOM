"use client";

import { useState, useTransition } from "react";
import { restoreDeleted } from "@/app/(app)/storage-actions";
import { LocalTime } from "@/components/ui/LocalTime";
import { Notice } from "@/components/ui/Notice";

export type DeletedEntry = { id: string; kind: "robot" | "system" | "part" | "item"; label: string; deletedAt: string; by: string | null; rows: number };

const KIND = { robot: "Robot", system: "System", part: "Part", item: "Inventory item" } as const;
// Settings → Recently deleted: robots, systems, manual parts and inventory items deleted in the
// last 30 days, each with what went with it (parts, history, versions, stock moves). An admin's
// Bring back puts it all back as it was.
export function RecentlyDeleted({ entries, isAdmin, keepDays }: { entries: DeletedEntry[]; isAdmin: boolean; keepDays: number }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ message?: string; error?: string }>({});
  const bringBack = (id: string) => {
    setBusy(id);
    start(async () => {
      const r = await restoreDeleted(id);
      setResult(r);
      setBusy(null);
    });
  };

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted">
        What was deleted in the last {keepDays} days, with everything that went with it: a robot&apos;s systems and parts, their history, versions and files, an
        item&apos;s stock moves and the parts that were linked to it. After {keepDays} days it&apos;s gone for good.
      </p>
      {result.error && <Notice tone="error">{result.error}</Notice>}
      {result.message && (
        <Notice tone="success">{result.message}</Notice>
      )}
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 transition-colors duration-150 hover:bg-raised">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {e.label}
                <span className="ml-2 rounded-full bg-raised px-2 py-0.5 text-[0.6875rem] font-semibold text-muted">{KIND[e.kind]}</span>
              </span>
              <span className="block truncate text-xs text-subtle">
                <LocalTime at={e.deletedAt} />
                {e.by ? ` · ${e.by}` : ""} · <span className="font-mono tabular-nums">{e.rows}</span> {e.rows === 1 ? "row" : "rows"}
              </span>
            </span>
            {isAdmin && (
              <button type="button" className="btn h-9 min-w-[7.5rem] active:scale-[0.98]" disabled={pending} onClick={() => bringBack(e.id)}>
                {busy === e.id ? "Bringing back…" : "Bring back"}
              </button>
            )}
          </li>
        ))}
        {!entries.length && <li className="px-3 py-3 text-sm text-muted">Nothing deleted in the last {keepDays} days.</li>}
      </ul>
      {!isAdmin && <p className="text-xs text-subtle">Only admins can bring something back.</p>}
    </div>
  );
}
