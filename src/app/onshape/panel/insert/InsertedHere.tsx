"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LocalTime } from "@/components/ui/LocalTime";
import type { InsertedRow } from "@/lib/onshape/insert";
import { updateInsert } from "../insert-actions";

// "Inserted here" (Harel, 2026-11-21): what went into this Part Studio or assembly from OrbitParts,
// each at its version; a system's insert with a newer CAD update shows "Newer: V13" and Update.
export function InsertedHere({ query, rows }: { query: string; rows: InsertedRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  if (!rows.length) return <p className="text-muted">Nothing inserted into this tab from OrbitParts yet.</p>;
  async function update(id: string) {
    setBusy(id);
    const r = await updateInsert(query, id).catch(() => ({ error: "Update failed. Try again.", message: undefined }));
    setBusy(null);
    setNote({ id, ok: !r.error, text: r.error ?? r.message ?? "Updated." });
    if (!r.error) router.refresh();
  }
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded-lg border border-border bg-surface p-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-fg">{r.label}</p>
              <p className="text-xs text-muted tabular-nums">
                {r.parts} part{r.parts === 1 ? "" : "s"} · {r.kind === "partstudio" ? "Derived" : "Instances"} · <LocalTime at={r.at} style="day" />
              </p>
            </div>
            {r.newer && (
              <span className="flex shrink-0 items-center gap-1">
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-500">Newer: {r.newer}</span>
                <button type="button" className="btn min-h-9 px-2 text-xs active:scale-[0.98] disabled:cursor-wait" disabled={busy === r.id} onClick={() => void update(r.id)}>
                  {busy === r.id ? "Updating…" : "Update"}
                </button>
              </span>
            )}
          </div>
          {note?.id === r.id && <p className={`mt-1 text-xs ${note.ok ? "text-emerald-500" : "text-red-500"}`}>{note.text}</p>}
        </li>
      ))}
    </ul>
  );
}
