"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { revertToVersion } from "@/app/(app)/versions-actions";
import { Dialog } from "@/components/Dialog";
import { useCan } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import type { VersionEntry, VersionList } from "@/lib/versions/history";
import { afterPartsUpdate } from "./afterUpdate";
import { ChangeBox } from "./CommitWindow";
import { CHECK_SYSTEM_EVENT, OPEN_VERSIONS_EVENT } from "./events";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

// The system's Versions window (plan/system-versioning.md §7): every committed version, newest
// first, as collapsible boxes with their parts' Before → After. Revert (Edit mode) puts the
// system's parts back on a version; the newer one stays on top, in green. Opens from the
// Versions button, an Outdated tag's missed update, or ?versions=1 (the right panel's tag). On
// phones Update system lives in its title bar instead of the page header.
export function VersionsWindow({ systemId, list, thumbs }: { systemId: string; list: VersionList; thumbs: Record<string, string | null> }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const edit = useCan("sync");
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const reverted = list.currentId !== list.latestId;

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_VERSIONS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_VERSIONS_EVENT, onOpen);
  }, []);
  const opened = useRef(false);
  useEffect(() => {
    if (params.get("versions") !== "1" || opened.current) return;
    opened.current = true;
    router.replace(pathname, { scroll: false });
    setOpen(true);
  }, [params, router, pathname]);

  const revert = (v: VersionEntry) => {
    if (!confirm(`Revert this system to ${v.label}? Its parts go back to how they were in that version; Onshape isn't changed.`)) return;
    start(async () => {
      setMessage(null);
      const r = await revertToVersion(systemId, v.id);
      setMessage(r.error ? { text: r.error, error: true } : { text: r.message ?? "Reverted." });
      if (!r.error) afterPartsUpdate(systemId, router);
    });
  };

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)} disabled={!list.versions.length && !edit} title="Every time this system was updated from Onshape">
        <Icon name="box" className="h-4 w-4" />
        Versions
        {reverted && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">Outdated</span>}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Versions"
        width="w-[min(46rem,calc(100vw-2rem))]"
        actions={
          edit && !reverted ? (
            <button
              type="button"
              className="btn h-8 px-3 text-sm sm:hidden"
              title="Check the Onshape assembly for changed, added and removed parts. Nothing reaches the BOM until you commit."
              onClick={() => {
                setOpen(false);
                window.dispatchEvent(new Event(CHECK_SYSTEM_EVENT));
              }}
            >
              Update system
            </button>
          ) : undefined
        }
      >
        <div className="space-y-3">
          {message && <p className={`text-sm ${message.error ? "text-rose-600" : "text-emerald-600"}`}>{message.text}</p>}
          {list.versions.length === 0 && <p className="text-sm text-muted">No versions yet. Update system checks Onshape for the first one.</p>}
          <ul className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
            {list.versions.map((v) => (
              <VersionBox
                key={v.id}
                systemId={systemId}
                version={v}
                current={v.id === list.currentId}
                latestAhead={reverted && v.id === list.latestId}
                open={expanded === v.id}
                onToggle={() => setExpanded(expanded === v.id ? null : v.id)}
                thumbs={thumbs}
                onRevert={edit && v.id !== list.currentId ? () => revert(v) : undefined}
                pending={pending}
              />
            ))}
          </ul>
        </div>
      </Dialog>
    </>
  );
}

function VersionBox({
  systemId,
  version: v,
  current,
  latestAhead,
  open,
  onToggle,
  thumbs,
  onRevert,
  pending,
}: {
  systemId: string;
  version: VersionEntry;
  current: boolean;
  latestAhead: boolean;
  open: boolean;
  onToggle: () => void;
  thumbs: Record<string, string | null>;
  onRevert?: () => void;
  pending: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const count = (k: string) => v.changes.filter((c) => c.change === k).length;
  const counts = [
    { n: count("modified"), label: "modified", className: "bg-sky-500/15 text-sky-600" },
    { n: count("added"), label: "added", className: "bg-emerald-500/15 text-emerald-600" },
    { n: count("removed"), label: "removed", className: "bg-rose-500/15 text-rose-600" },
  ].filter((c) => c.n > 0);
  return (
    <li className={`panel overflow-hidden ${latestAhead ? "border-emerald-500/60 bg-emerald-500/5" : current ? "border-accent/50" : ""}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={onToggle} aria-expanded={open} className="press flex min-w-0 flex-1 items-center gap-2 text-left">
          <Icon name="chevron" className={`h-4 w-4 shrink-0 text-subtle transition-transform ${open ? "rotate-90" : ""}`} />
          <span className="rounded-md bg-accent/10 px-2 py-0.5 font-mono text-sm font-bold text-accent">{v.label}</span>
          <span className="min-w-0 truncate text-sm font-semibold">{v.name && v.name !== v.label ? v.name : ""}</span>
          <span className="ml-auto shrink-0 text-xs text-subtle tabular-nums">
            {when(v.at)}
            {v.by && ` · ${v.by}`}
          </span>
        </button>
        {current && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">Current</span>}
        {latestAhead && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-semibold text-white">Latest</span>}
        {onRevert && (
          <button type="button" className="btn h-7 px-2 text-xs" disabled={pending} onClick={onRevert}>
            {latestAhead ? "Back to latest" : "Revert"}
          </button>
        )}
      </div>
      {counts.length > 0 && (
        <div className="flex gap-1.5 px-3 pb-2 pl-9">
          {counts.map((c) => (
            <span key={c.label} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.className}`}>
              <span className="font-mono tabular-nums">{c.n}</span> {c.label}
            </span>
          ))}
        </div>
      )}
      {open && (
        <ul className="space-y-2 border-t border-line p-3">
          {v.changes.length === 0 && <li className="text-sm text-muted">{v.seq === 0 ? "The parts as they were before version control." : "No part changes."}</li>}
          {v.changes.map((c) => (
            <ChangeBox
              key={`${c.change}:${c.key}`}
              systemId={systemId}
              change={c}
              thumb={c.partId ? (thumbs[c.partId] ?? null) : null}
              open={expanded === c.key}
              onToggle={() => setExpanded(expanded === c.key ? null : c.key)}
              before={c.rowId && c.change !== "added" ? { side: "before", rowId: c.rowId } : null}
              after={c.rowId && c.change !== "removed" ? { side: "after", rowId: c.rowId } : null}
              committing={false}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
