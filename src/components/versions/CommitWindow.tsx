"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Icon } from "@/components/ui/Icon";
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

// The Commit Changes window (plan/system-versioning.md §7): what changed in the Manufacture
// assembly, a name for the version, and Commit. Each part's box opens its Before → After 3D
// preview and can commit that part alone. In View mode it is read-only.
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
}: {
  open: boolean;
  onClose: () => void;
  systemId: string;
  draft: Draft;
  thumbs: Record<string, string | null>;
  canCommit: boolean;
  committing: boolean;
  error: string | null;
  onCommit: (name: string, only?: string) => void;
}) {
  // Starts with the Onshape version's name; another name renames it in Onshape on commit.
  const [name, setName] = useState(draft.name ?? draft.onshape ?? "");
  const [expanded, setExpanded] = useState<string | null>(null);
  const counts = (["modified", "props", "added", "removed"] as const)
    .map((k) => ({ k, n: draft.changes.filter((c) => kindOf(c) === k).length }))
    .filter((c) => c.n > 0);

  return (
    <Dialog open={open} onClose={onClose} title="Changes in Onshape" width="w-[min(46rem,calc(100vw-2rem))]">
      <div className="space-y-4">
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
              onCommit(name);
            }}
          >
            <label className="min-w-48 flex-1">
              <span className="label">Version name (the same in Onshape)</span>
              <input className="input" value={name} maxLength={120} placeholder="e.g. Shorter intake arm" onChange={(e) => setName(e.target.value)} />
              {draft.onshape && name.trim() && name.trim() !== draft.onshape && (
                <span className="mt-1 block text-xs text-subtle">
                  Renames <span className="font-mono tabular-nums">{draft.onshape}</span> in Onshape too.
                </span>
              )}
              {!draft.onshape && name.trim() && <span className="mt-1 block text-xs text-subtle">Saves a version with this name in Onshape too.</span>}
            </label>
            <button type="submit" className="btn-primary" disabled={committing}>
              {committing ? "Committing…" : "Commit changes"}
            </button>
          </form>
        ) : (
          <p className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-muted">The CAD Team commits these changes to the BOM.</p>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}

        <ul className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
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
              onCommit={canCommit ? () => onCommit(name, c.key) : undefined}
              committing={committing}
            />
          ))}
        </ul>
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
          {c.geometry && <p className="text-fg">The part&rsquo;s shape changed in Onshape.</p>}
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
    <div className="relative h-44 overflow-hidden rounded-lg border border-line bg-[radial-gradient(ellipse_at_50%_35%,var(--color-surface)_0%,var(--color-raised)_75%)]">
      <span className="absolute top-2 left-2 z-10 rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-semibold text-muted">{label}</span>
      {model && <ModelCanvas model={model} colors={NO_COLORS} mode="cad" locateKey={null} onLocated={noop} />}
      {!model && <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted">{error ?? "Loading…"}</div>}
    </div>
  );
}

const noop = () => {};
