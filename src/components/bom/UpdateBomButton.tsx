"use client";

import { useState, useTransition } from "react";
import { syncSystem, type SyncResult } from "@/app/(app)/parts-actions";

export function UpdateBomButton({ systemId, lastSyncedAt }: { systemId: string; lastSyncedAt: Date | null }) {
  const [result, setResult] = useState<SyncResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        className="btn"
        disabled={pending}
        title="Re-fetch this system's Bill of Materials from Onshape. Existing part numbers, statuses, progress and notes are kept."
        onClick={() => start(async () => setResult(await syncSystem(systemId)))}
      >
        {pending ? "Updating from Onshape…" : "Update BOM from Onshape"}
      </button>
      {result?.message && <span className="text-sm text-emerald-300">{result.message}</span>}
      {result?.error && <span className="text-sm text-rose-300">{result.error}</span>}
      {!result && lastSyncedAt && (
        <span className="text-xs text-slate-500">Last updated {lastSyncedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
      )}
    </div>
  );
}
