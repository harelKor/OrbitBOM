"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Icon } from "@/components/ui/Icon";
import type { ViewerModel } from "@/components/dashboard/ModelCanvas";
import type { CadChange } from "@/lib/versions/cadDiff";

const ModelCanvas = dynamic(() => import("@/components/dashboard/ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });
const NO_COLORS = new Map<string, string>();
const noop = () => {};

const CHIP: Record<string, { label: string; className: string }> = {
  modified: { label: "Changed", className: "bg-sky-500/15 text-sky-600" },
  count: { label: "Count", className: "bg-amber-500/15 text-amber-600" },
  added: { label: "Added", className: "bg-emerald-500/15 text-emerald-600" },
  removed: { label: "Removed", className: "bg-rose-500/15 text-rose-600" },
};
const chipOf = (c: CadChange) => CHIP[c.change === "modified" && !c.geometry ? "count" : c.change];

// Update CAD / Update Basepart's Commit window (Harel, 2026-11-13): the parts added, removed and
// changed in Onshape since the model's last update, each opening its Before → After 3D (from the
// stored files, no Onshape calls), then Commit, which makes this state the model's: as a new
// Onshape version when "Create version" is ticked, else as a sub-version ("V12 v1"). All or nothing.
export function CadCommitWindow({
  open,
  onClose,
  robotId,
  what,
  changes,
  committing,
  error,
  onCommit,
}: {
  open: boolean;
  onClose: () => void;
  robotId: string;
  what: "CAD" | "Basepart";
  changes: CadChange[];
  committing: boolean;
  error: string | null;
  onCommit: (makeVersion: boolean, name: string) => void;
}) {
  const [makeVersion, setMakeVersion] = useState(false);
  const [name, setName] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const counts = (["modified", "count", "added", "removed"] as const)
    .map((k) => ({ k, n: changes.filter((c) => chipOf(c) === CHIP[k]).length }))
    .filter((c) => c.n > 0);
  return (
    <Dialog open={open} onClose={onClose} title={`Update ${what}: changes in Onshape`} width="w-[min(46rem,calc(100vw-2rem))]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {counts.length ? (
            counts.map(({ k, n }) => (
              <span key={k} className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${CHIP[k].className}`}>
                <span className="font-mono">{n}</span> {CHIP[k].label.toLowerCase()}
              </span>
            ))
          ) : (
            <span>No part changed since the last update.</span>
          )}
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onCommit(makeVersion, makeVersion ? name : "");
          }}
        >
          <label className="flex items-start gap-3 text-sm pointer-coarse:min-h-9">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={makeVersion} onChange={(e) => setMakeVersion(e.target.checked)} />
            <span>
              <span className="font-semibold">Create version</span>
              <span className="block text-xs text-subtle">
                {makeVersion ? "Makes a new Onshape version of this state." : "Off: a sub-version of the newest Onshape version (like “V12 v1”), with no new Onshape version."}
              </span>
            </span>
          </label>
          {makeVersion && (
            <label className="block">
              <span className="label">Version name (optional)</span>
              <input className="input" value={name} maxLength={120} placeholder="The next V number" onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <button type="submit" className="btn-primary h-11 w-full justify-center text-base" disabled={committing || (!changes.length && !makeVersion)}>
            {committing ? "Committing…" : `Commit ${what === "CAD" ? "CAD" : "Basepart"}`}
          </button>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </form>

        {changes.length > 0 && (
          <ul className="max-h-[50dvh] space-y-2 overflow-y-auto pr-1">
            {changes.map((c) => {
              const isOpen = expanded === c.key;
              const chip = chipOf(c);
              return (
                <li key={`${c.change}:${c.key}`} className="panel overflow-hidden">
                  <button type="button" onClick={() => setExpanded(isOpen ? null : c.key)} aria-expanded={isOpen} className="press flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-raised pointer-coarse:min-h-11">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                    {c.count && (
                      <span className="text-xs text-subtle tabular-nums">
                        ×{c.count.from} → ×{c.count.to}
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${chip.className}`}>{chip.label}</span>
                    <Icon name="chevron" className={`h-4 w-4 text-subtle transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="space-y-2 border-t border-line px-3 py-3 text-sm">
                      {c.geometry && <p className="text-fg">{c.note ? "No shape was stored for this part before, so it can't be compared: check Before → After." : "The part’s shape changed."}</p>}
                      {c.before && c.after ? (
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                          <Preview robotId={robotId} file={c.before.file} k={c.before.k} label="Before" />
                          <Icon name="arrow" className="h-5 w-5 text-accent" />
                          <Preview robotId={robotId} file={c.after.file} k={c.after.k} label="After" />
                        </div>
                      ) : (
                        <div className="grid grid-cols-1">
                          {c.before && <Preview robotId={robotId} file={c.before.file} k={c.before.k} label="Removed" />}
                          {c.after && <Preview robotId={robotId} file={c.after.file} k={c.after.k} label="Added" />}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

function Preview({ robotId, file, k, label }: { robotId: string; file: string; k: string; label: string }) {
  const [model, setModel] = useState<ViewerModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/robots/${robotId}/cad-preview?${new URLSearchParams({ file, k })}`)
      .then(async (res) => {
        const r = (await res.json().catch(() => ({}))) as { model?: ViewerModel; error?: string };
        if (cancelled) return;
        if (r.model) setModel(r.model);
        else setError(r.error ?? `The 3D preview failed (${res.status}).`);
      })
      .catch(() => !cancelled && setError("The 3D preview couldn't load."));
    return () => {
      cancelled = true;
    };
  }, [robotId, file, k]);
  return (
    <div className="relative h-44 overflow-hidden stage-frame">
      <span className="absolute top-2 left-2 z-10 rounded-full bg-surface/90 px-2 py-0.5 text-[0.6875rem] font-semibold text-muted">{label}</span>
      {model && <ModelCanvas model={model} colors={NO_COLORS} mode="cad" locateKey={null} onLocated={noop} />}
      {!model && <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted">{error ?? "Loading…"}</div>}
    </div>
  );
}
