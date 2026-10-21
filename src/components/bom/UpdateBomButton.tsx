"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { syncSystem, type SyncResult } from "@/app/(app)/parts-actions";

type ThumbRound = { fetched: number; pending: number; calls: number; failed?: number; error?: string } | { error: string };

// Update BOM, then the new thumbnails in rounds (each round has up to four minutes) until none
// are left or a round makes no progress.
export function UpdateBomButton({ systemId, lastSyncedAt }: { systemId: string; lastSyncedAt: Date | null }) {
  const router = useRouter();
  const [result, setResult] = useState<SyncResult | null>(null);
  const [thumbs, setThumbs] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function fetchThumbnails() {
    let fetched = 0;
    let calls = 0;
    for (let round = 0; round < 10; round++) {
      setThumbs(fetched ? `Fetching thumbnails… ${fetched} so far` : "Fetching thumbnails…");
      const res = await fetch(`/api/systems/${systemId}/thumbnails`, { method: "POST" }).catch(() => null);
      const r = ((await res?.json().catch(() => null)) ?? { error: `Thumbnails stopped (${res?.status ?? "network"}).` }) as ThumbRound;
      if ("error" in r && !("fetched" in r)) return setThumbs(r.error);
      const t = r as Exclude<ThumbRound, { error: string }>;
      fetched += t.fetched;
      calls += t.calls;
      if (t.fetched) router.refresh();
      const failed = t.failed ? ` ${t.failed} failed: ${t.error}` : "";
      if (!t.pending || !t.fetched) {
        const left = t.pending ? ` ${t.pending} left, press Update BOM again.` : "";
        return setThumbs(`Thumbnails: ${fetched} new (${calls} Onshape calls).${left}${failed}`);
      }
    }
    setThumbs(`Thumbnails: ${fetched} new so far. Press Update BOM again for the rest.`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        className="btn"
        disabled={pending}
        title="Re-fetch this system's Bill of Materials from Onshape. Existing names, statuses, progress and notes are kept."
        onClick={() =>
          start(async () => {
            setThumbs(null);
            const r = await syncSystem(systemId);
            setResult(r);
            if (!r.error) await fetchThumbnails();
          })
        }
      >
        {pending ? "Updating from Onshape…" : "Update BOM from Onshape"}
      </button>
      {result?.message && <span className="text-sm text-emerald-700">{result.message}</span>}
      {thumbs && <span className="text-sm text-fg-2">{thumbs}</span>}
      {result?.error && <span className="text-sm text-rose-700">{result.error}</span>}
      {!result && lastSyncedAt && (
        <span className="text-xs text-subtle">Last updated {lastSyncedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
      )}
    </div>
  );
}
