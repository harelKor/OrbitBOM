"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Icon } from "@/components/ui/Icon";
import { LocalTime } from "@/components/ui/LocalTime";
import { getMachine } from "@/config/machines";
import type { VersionChange } from "@/db/schema";
import type { ViewerModel } from "@/components/dashboard/ModelCanvas";
import type { Draft } from "@/lib/versions/detect";

const ModelCanvas = dynamic(() => import("@/components/dashboard/ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });
const NO_COLORS = new Map<string, string>();

const CHANGE_CHIP: Record<VersionChange["change"] | "props", { label: string; className: string }> = {
  added: { label: "Added", className: "bg-emerald-500/15 text-emerald-600" },
  modified: { label: "Modified", className: "bg-sky-500/15 text-sky-600" },
  props: { label: "Properties", className: "bg-amber-500/15 text-amber-600" },
  removed: { label: "Removed", className: "bg-rose-500/15 text-rose-600" },
};

const FIELD_NAMES: Record<string, string> = {
  onshapeName: "Name",
  description: "Description",
  material: "Material",
  onshapeMaterial: "Onshape material",
  quantity: "Quantity",
  preProcess: "Pre-process",
  process1: "Process 1",
  process2: "Process 2",
};
const PROCESS_FIELDS = new Set(["preProcess", "process1", "process2"]);

function shown(field: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (PROCESS_FIELDS.has(field)) return getMachine(String(value))?.name ?? String(value);
  return String(value);
}

// A change that is only Onshape fields (material, processes, quantity…) and not the shape.
const kindOf = (c: VersionChange) => (c.change === "modified" && !c.geometry ? "props" : c.change);

// A CAD Review comment still to act on (Open, On it) the commit can set To check.
export type CommitComment = { id: string; body: string; partName: string | null; author: string | null; createdAt: string };

// The Commit Changes window (plan/system-versioning.md §7): what changed in the Manufacture
// assembly, a name for the version, and Commit. Each part's box opens its Before → After 3D
// preview and can commit that part alone. In View mode it is read-only. With open CAD Review
// comments, a panel on the right ticks them off with this version (Harel, 2026-11-08).
export function CommitWindow({
  open,
  onClose,
  systemId,
  draft,
  thumbs,
  canCommit,
  committing,
  error,
  onCommit,
  comments = [],
}: {
  open: boolean;
  onClose: () => void;
  systemId: string;
  draft: Draft;
  thumbs: Record<string, string | null>;
  canCommit: boolean;
  committing: boolean;
  error: string | null;
  // `update3d`: the 3D views and pictures move to this version too (Harel, 2026-11-11).
  onCommit: (name: string, only?: string, tick?: string[], update3d?: boolean) => void;
  comments?: CommitComment[];
}) {
  const [tick, setTick] = useState<Set<string>>(() => new Set());
  const ticked = [...tick].filter((id) => comments.some((c) => c.id === id));
  const side = comments.length > 0;
  // The site version's name and the Onshape version's description. Onshape names the version
  // itself: "V<next> BOM release" (lib/versions/onshapeName.ts).
  const [name, setName] = useState(draft.name ?? "");
  // Update 3D views too, or only the BOM and its export files, which saves the 3D export's
  // calls when the Build team only needs the right files (Harel, 2026-11-11).
  const [update3d, setUpdate3d] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const counts = (["modified", "props", "added", "removed"] as const)
    .map((k) => ({ k, n: draft.changes.filter((c) => kindOf(c) === k).length }))
    .filter((c) => c.n > 0);

  return (
    <Dialog open={open} onClose={onClose} title="Changes in Onshape" width={side ? "w-[min(68rem,calc(100vw-2rem))]" : "w-[min(46rem,calc(100vw-2rem))]"}>
      <div className={side ? "grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]" : ""}>
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {draft.onshape && <span className="rounded-full bg-accent/10 px-2 py-0.5 font-mono text-xs font-semibold text-accent">Onshape {draft.onshape}</span>}
          <span>Found {new Date(draft.detectedAt).toLocaleString()}</span>
          {counts.map(({ k, n }) => (
            <span key={k} className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${CHANGE_CHIP[k].className}`}>
              <span className="font-mono">{n}</span> {CHANGE_CHIP[k].label.toLowerCase()}
            </span>
          ))}
        </div>

        {canCommit ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onCommit(name, undefined, ticked, update3d);
            }}
          >
            <label className="min-w-48 flex-1">
              <span className="label">What changed (optional)</span>
              <input className="input" value={name} maxLength={120} placeholder="e.g. Shorter intake arm" onChange={(e) => setName(e.target.value)} />
              <span className="mt-1 block text-xs text-subtle">
                {draft.onshape ? (
                  <>
                    The BOM goes on <span className="font-mono tabular-nums">{draft.onshape}</span>.
                  </>
                ) : (
                  <>Onshape gets a version named “V… BOM release”{name.trim() ? " with this as its description" : ""}.</>
                )}
              </span>
            </label>
            <label className="flex w-full items-start gap-2 text-sm pointer-coarse:min-h-9">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={update3d} onChange={(e) => setUpdate3d(e.target.checked)} />
              <span>
                Update the 3D views and pictures too
                <span className="block text-xs text-subtle">Off: only the BOM and the export files the Build team downloads move. Saves Onshape calls.</span>
              </span>
            </label>
            <button type="submit" className="btn-primary" disabled={committing}>
              {committing ? "Committing…" : ticked.length ? `Commit · ${ticked.length} to check` : "Commit changes"}
            </button>
          </form>
        ) : (
          <p className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-muted">The CAD Team commits these changes to the BOM.</p>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}

        <ul className="max-h-[55dvh] space-y-2 overflow-y-auto pr-1">
          {draft.changes.map((c) => (
            <ChangeBox
              key={`${c.change}:${c.key}`}
              systemId={systemId}
              before={c.partId && c.change !== "added" ? { side: "before", partId: c.partId } : null}
              after={c.change !== "removed" ? { side: "after", draftId: draft.id, key: c.key } : null}
              change={c}
              thumb={c.partId ? (thumbs[c.partId] ?? null) : null}
              open={expanded === c.key}
              onToggle={() => setExpanded(expanded === c.key ? null : c.key)}
              onCommit={canCommit ? () => onCommit(name, c.key, ticked, update3d) : undefined}
              committing={committing}
            />
          ))}
        </ul>
      </div>
      {side && (
        <aside className="flex min-h-0 flex-col rounded-lg border border-line bg-raised/50 md:max-h-[70dvh]">
          <div className="border-b border-line px-3 py-2">
            <h3 className="text-sm font-semibold text-fg">Open comments</h3>
            <p className="text-xs text-muted">Tick the ones this version fixes. They go To check, for a mentor.</p>
          </div>
          <ul className="flex-1 space-y-1 overflow-y-auto p-2">
            {comments.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer gap-2.5 rounded-md p-2 hover:bg-surface pointer-coarse:min-h-11">
                  <input
                    type="checkbox"
                    disabled={!canCommit}
                    checked={tick.has(c.id)}
                    onChange={() =>
                      setTick((t) => {
                        const next = new Set(t);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className={`block whitespace-pre-wrap break-words ${tick.has(c.id) ? "text-muted line-through" : "text-fg"}`}>{c.body}</span>
                    <span className="mt-0.5 block text-[0.6875rem] text-subtle">
                      {c.partName && <span className="font-semibold text-fg-2">{c.partName} · </span>}
                      {c.author ?? "Someone"} · <LocalTime at={c.createdAt} />
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </aside>
      )}
      </div>
    </Dialog>
  );
}

export function ChangeBox({
  systemId,
  before,
  after,
  change: c,
  thumb,
  open,
  onToggle,
  onCommit,
  committing,
}: {
  systemId: string;
  before: PreviewReq | null;
  after: PreviewReq | null;
  change: VersionChange;
  thumb: string | null;
  open: boolean;
  onToggle: () => void;
  onCommit?: () => void;
  committing: boolean;
}) {
  const chip = CHANGE_CHIP[kindOf(c)];
  const fields = Object.entries(c.fields);
  return (
    <li className="panel overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={open} className="press flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-raised">
        <span className="thumb-well flex h-10 w-12 shrink-0 items-center justify-center rounded">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable */}
          {thumb ? <img src={thumb} alt="" className="h-full w-full object-contain" /> : <Icon name="cube" className="h-5 w-5 text-subtle" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{c.name}</span>
          {c.partNumber && <span className="block truncate font-mono text-xs text-subtle tabular-nums">{c.partNumber}</span>}
        </span>
        {c.note && <span className="hidden text-xs text-subtle sm:inline">{c.note}</span>}
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${chip.className}`}>{chip.label}</span>
        <Icon name="chevron" className={`h-4 w-4 text-subtle transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-3 text-sm">
          {c.geometry && (
            <p className="text-fg">
              {c.note === "Shape not compared before" ? "No shape was stored for this part before, so it can't be compared: check Before → After." : "The part’s shape changed in Onshape."}
            </p>
          )}
          {c.change === "added" && <p className="text-muted">{c.note === "Back in CAD" ? "Back in the assembly; its BOM data is kept." : "New in the assembly."}</p>}
          {c.change === "removed" && <p className="text-muted">No longer in the assembly. It is hidden from the BOM; its data is kept.</p>}
          {fields.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {fields.map(([field, { from, to }]) => (
                <span key={field} title={FIELD_NAMES[field] ?? field} className="rounded-full border border-line bg-raised px-2 py-0.5 text-xs tabular-nums">
                  <span className="text-subtle line-through">{shown(field, from)}</span> <span className="text-subtle">→</span>{" "}
                  <span className="font-semibold text-fg">{shown(field, to)}</span>
                </span>
              ))}
            </div>
          )}
          <Previews systemId={systemId} before={before} after={after} change={c} />
          {onCommit && (
            <div className="flex justify-end">
              <button type="button" className="btn" disabled={committing} onClick={onCommit}>
                Commit this part
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// Before → After for a changed shape; one view for an added or removed part, or when only its
// properties changed.
function Previews({ systemId, before, after, change: c }: { systemId: string; before: PreviewReq | null; after: PreviewReq | null; change: VersionChange }) {
  if (c.change === "modified" && !c.geometry)
    return (
      <div className="grid grid-cols-1">
        {(before ?? after) && <Preview systemId={systemId} req={(before ?? after)!} label="Shape unchanged" />}
      </div>
    );
  if (!before || !after)
    return (
      <div className="grid grid-cols-1">
        {before && <Preview systemId={systemId} req={before} label="Removed" />}
        {after && <Preview systemId={systemId} req={after} label="Added" />}
      </div>
    );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <Preview systemId={systemId} req={before} label="Before" />
      <Icon name="arrow" className="h-5 w-5 text-accent" />
      <Preview systemId={systemId} req={after} label="After" />
    </div>
  );
}

export type PreviewReq = { side: "before" | "after"; partId?: string; draftId?: string; key?: string; rowId?: string };

function Preview({ systemId, req, label }: { systemId: string; req: PreviewReq; label: string }) {
  const [model, setModel] = useState<ViewerModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = JSON.stringify(req);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/systems/${systemId}/preview`, { method: "POST", headers: { "content-type": "application/json" }, body })
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
  }, [systemId, body]);
  return (
    <div className="relative h-44 overflow-hidden stage-frame">
      <span className="absolute top-2 left-2 z-10 rounded-full bg-surface/90 px-2 py-0.5 text-[0.6875rem] font-semibold text-muted">{label}</span>
      {model && <ModelCanvas model={model} colors={NO_COLORS} mode="cad" locateKey={null} onLocated={noop} />}
      {!model && <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted">{error ?? "Loading…"}</div>}
    </div>
  );
}

const noop = () => {};
