"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { partVersionHistory, updateFabVersion } from "@/app/(app)/versions-actions";
import { Dialog } from "@/components/Dialog";
import { useCan } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { toast } from "@/components/ui/Toaster";
import type { FabLock } from "@/lib/data/parts";
import type { PartVersionEntry } from "@/lib/versions/history";
import { ChangeBox } from "./CommitWindow";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

// Released (gold) and Reproduction / Secondary Production (red) on a version the part was sent to fab at.
const RELEASE_TAG: Record<string, string> = {
  Released: "bg-amber-500 text-slate-950",
  Reproduction: "bg-red-600 text-white",
  "Secondary Production": "bg-orange-500 text-white",
};

// The locked fab version beside the part's name in its window (plan/fab-version-lock.md §3):
// "Fab: V4 · Intake Final", and "(BOM: V5)" when the BOM has moved past it.
export function FabVersionBadge({ lock }: { lock: FabLock }) {
  const label = lock.label ?? "locked";
  return (
    <span
      className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 align-middle text-[0.6875rem] font-semibold ${lock.changed ? "bg-red-600/15 text-red-500" : "bg-amber-500/15 text-amber-500"}`}
      title={`Shop Fab shows the part as it was released${lock.label ? ` at ${lock.label}` : ""}, ${new Date(lock.at).toLocaleDateString()}.`}
    >
      <Icon name="lock" className="h-3 w-3" />
      <span className="max-w-[8rem] truncate font-mono tabular-nums">Fab: {label}</span>
      {lock.name && lock.name !== lock.label && <span className="max-w-[10rem] truncate">· {lock.name}</span>}
      {lock.bomLabel && <span className="max-w-[8rem] truncate font-mono tabular-nums">(BOM: {lock.bomLabel})</span>}
    </span>
  );
}

// The part window's Versions button and window: only the versions that added, changed or removed
// this part, newest first, each with its Before → After, and gold / red tags where it was released
// or sent to reproduction. "Update fab version" (Edit, CAD) moves To Fab to the latest state.
export function PartVersionsButton({ partId, lock, released }: { partId: string; lock: FabLock | null | undefined; released: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ systemId: string | null; entries: PartVersionEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canSync = useCan("sync");
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    partVersionHistory(partId)
      .then((r) => {
        if (cancelled) return;
        if (r.error) setError(r.error);
        else setData({ systemId: r.systemId ?? null, entries: r.entries ?? [] });
      })
      .catch(() => !cancelled && setError("Couldn't load the part's versions."));
    return () => {
      cancelled = true;
    };
  }, [open, partId]);

  const relock = () =>
    start(async () => {
      const r = await updateFabVersion(partId);
      toast(r.error ?? r.message ?? "Updated.", !!r.error);
      if (!r.error) router.refresh();
    });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn h-8 text-xs active:scale-[0.98]" onClick={() => setOpen(true)} title="The versions that changed this part">
          <Icon name="box" className="h-3.5 w-3.5" />
          Versions
        </button>
        {canSync && released && (!lock || lock.bomLabel || lock.changed) && (
          <button type="button" className="btn h-8 text-xs active:scale-[0.98]" disabled={pending} onClick={relock} title="Shop Fab takes this part's latest version; its status stays">
            <Icon name="lock" className="h-3.5 w-3.5" />
            Update fab version
          </button>
        )}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Part versions" width="w-[min(46rem,calc(100vw-2rem))]">
        <div className="space-y-3">
          {error && <p className="text-sm text-rose-600">{error}</p>}
          {!data && !error && <p className="text-sm text-muted">Loading…</p>}
          {data && !data.entries.length && <p className="text-sm text-muted">No committed versions changed this part yet.</p>}
          {data && data.entries.length > 0 && (
            <ul className="max-h-[65dvh] space-y-2 overflow-y-auto pr-1">
              {data.entries.map((v) => {
                const tagged = v.released.length > 0;
                const reproduction = v.released.some((s) => s !== "Released");
                return (
                  <li
                    key={v.id}
                    className={`panel overflow-hidden ${tagged ? (reproduction ? "border-red-500/60 bg-red-500/5" : "border-amber-500/60 bg-amber-500/5") : v.current ? "border-accent/50" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="max-w-[10rem] truncate rounded-md bg-accent/10 px-2 py-0.5 font-mono text-sm font-bold text-accent tabular-nums">{v.label}</span>
                      <span className="min-w-0 truncate text-sm font-semibold">{v.name && v.name !== v.label ? v.name : ""}</span>
                      {v.released.map((s) => (
                        <span key={s} className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-bold ${RELEASE_TAG[s] ?? RELEASE_TAG.Released}`}>
                          {s}
                        </span>
                      ))}
                      {v.current && <span className="rounded-full bg-accent px-2 py-0.5 text-[0.6875rem] font-semibold text-white">BOM</span>}
                      <span className="ml-auto shrink-0 text-xs text-subtle tabular-nums">
                        {when(v.at)}
                        {v.by && ` · ${v.by}`}
                      </span>
                    </div>
                    {data.systemId && (
                      <ul className="border-t border-line p-2">
                        <ChangeBox
                          systemId={data.systemId}
                          change={v.change}
                          thumb={null}
                          open={expanded === v.id}
                          onToggle={() => setExpanded(expanded === v.id ? null : v.id)}
                          before={v.change.change !== "added" ? { side: "before", rowId: v.id } : null}
                          after={v.change.change !== "removed" ? { side: "after", rowId: v.id } : null}
                          committing={false}
                        />
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Dialog>
    </>
  );
}
