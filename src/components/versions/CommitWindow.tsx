"use client";

import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Icon } from "@/components/ui/Icon";
import { getMachine } from "@/config/machines";
import type { VersionChange } from "@/db/schema";
import type { Draft } from "@/lib/versions/detect";

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
// assembly, a name for the version, and Commit. In View mode it is read-only.
export function CommitWindow({
  open,
  onClose,
  draft,
  thumbs,
  canCommit,
  committing,
  error,
  onCommit,
}: {
  open: boolean;
  onClose: () => void;
  draft: Draft;
  thumbs: Record<string, string | null>;
  canCommit: boolean;
  committing: boolean;
  error: string | null;
  onCommit: (name: string) => void;
}) {
  const [name, setName] = useState(draft.name ?? "");
  const [expanded, setExpanded] = useState<string | null>(null);
  const counts = (["modified", "props", "added", "removed"] as const)
    .map((k) => ({ k, n: draft.changes.filter((c) => kindOf(c) === k).length }))
    .filter((c) => c.n > 0);

  return (
    <Dialog open={open} onClose={onClose} title="Changes in Onshape" width="w-[min(46rem,calc(100vw-2rem))]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
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
              <span className="label">Version name</span>
              <input className="input" value={name} maxLength={120} placeholder="e.g. Shorter intake arm" onChange={(e) => setName(e.target.value)} />
            </label>
            <button type="submit" className="btn-primary" disabled={committing}>
              {committing ? "Committing…" : "Commit changes"}
            </button>
          </form>
        ) : (
          <p className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-muted">Switch to Edit to commit these changes to the BOM.</p>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}

        <ul className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {draft.changes.map((c) => (
            <ChangeBox key={`${c.change}:${c.key}`} change={c} thumb={c.partId ? (thumbs[c.partId] ?? null) : null} open={expanded === c.key} onToggle={() => setExpanded(expanded === c.key ? null : c.key)} />
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

function ChangeBox({ change: c, thumb, open, onToggle }: { change: VersionChange; thumb: string | null; open: boolean; onToggle: () => void }) {
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
        </div>
      )}
    </li>
  );
}
