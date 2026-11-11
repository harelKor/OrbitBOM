"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TreeComment } from "@/components/review/Comments";
import { LocalTime } from "@/components/ui/LocalTime";
import type { ReviewComment } from "@/lib/data/cadReview";
import type { TreeNode } from "@/lib/reviews/tree";

// The version tree, like Onshape's: the newest version big on top, older ones down a line. A
// version the BOM was updated to carries a BOM mark. A tap on a version folds its comments away
// (Harel, 2026-11-09).
export function VersionTree({
  tree,
  comments,
  onFocus,
  refresh,
}: {
  tree: TreeNode[];
  comments: Map<string, ReviewComment>;
  onFocus: (key: string) => void;
  refresh?: { systemId: string; readAt: string | null } | null; // the Refresh from Onshape button
}) {
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const [top, ...rest] = tree;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="label">Versions</h2>
        {refresh && <RefreshVersions systemId={refresh.systemId} readAt={refresh.readAt} />}
      </div>
      {!top ? (
        <p className="text-sm text-muted">No versions yet. Update system brings the first one.</p>
      ) : (
        <>
          <div className="rounded-lg border-2 border-accent/50 bg-accent/5 p-3">
            <button className="press block w-full text-left pointer-coarse:min-h-9" onClick={() => toggle(top.key)} aria-expanded={!folded.has(top.key)}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-2xl font-bold text-accent tabular-nums">{top.name || "Unnamed"}</span>
                <BomMarks node={top} />
                <Count node={top} folded={folded.has(top.key)} />
              </span>
              <NodeMeta node={top} />
            </button>
            {!folded.has(top.key) && (
              <>
                {top.description && <p className="mt-1 text-xs whitespace-pre-wrap text-fg-2">{top.description}</p>}
                <NodeComments node={top} comments={comments} onFocus={onFocus} />
              </>
            )}
            <SubVersions node={top} newest />
          </div>
          {rest.length > 0 && (
            <ol className="relative ml-2 border-l-2 border-line">
              {rest.map((n) => (
                <li key={n.key} className="relative pb-3 pl-4">
                  <span className={`absolute top-1.5 -left-[7px] h-3 w-3 rounded-full border-2 border-surface ${n.bom.length ? "bg-accent" : "bg-line"}`} />
                  <button className="press block w-full text-left pointer-coarse:min-h-9" onClick={() => toggle(n.key)} aria-expanded={!folded.has(n.key)}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-fg tabular-nums">{n.name || "Unnamed"}</span>
                      <BomMarks node={n} />
                      <Count node={n} folded={folded.has(n.key)} />
                    </span>
                    <NodeMeta node={n} />
                  </button>
                  {!folded.has(n.key) && <NodeComments node={n} comments={comments} onFocus={onFocus} />}
                  <SubVersions node={n} newest={false} />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

// Update CAD's sub-versions of a version ("V12 v1", Harel 2026-11-11): a small branch off it.
// Open on the newest version, where work goes on; once a newer Onshape version exists, the branch
// folds into its version and opens with a tap.
function SubVersions({ node, newest }: { node: TreeNode; newest: boolean }) {
  const [open, setOpen] = useState(newest);
  if (!node.subs.length) return null;
  const n = node.subs.length;
  return (
    <div className="mt-1.5 ml-1">
      <button className="press flex items-center gap-1 text-[11px] font-semibold text-violet-600 pointer-coarse:min-h-9" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span aria-hidden className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        {n} sub-version{n === 1 ? "" : "s"}
      </button>
      {open && (
        <ol className="mt-1 ml-1.5 border-l-2 border-dashed border-violet-500/40">
          {[...node.subs].reverse().map((s) => (
            <li key={s.id} className="relative py-0.5 pl-3">
              <span className="absolute top-2 -left-[5px] h-2 w-2 rounded-full bg-violet-500/70" aria-hidden />
              <span className="font-mono text-xs font-semibold text-fg tabular-nums">{s.label}</span>
              <span className="block text-[10px] text-subtle">
                {s.by ? `${s.by} · ` : ""}
                <LocalTime at={s.at} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// How many comments a folded version holds.
function Count({ node, folded }: { node: TreeNode; folded: boolean }) {
  const n = node.added.length + node.done.length;
  if (!folded || !n) return null;
  return <span className="rounded-full bg-raised px-1.5 text-[11px] text-fg-2 tabular-nums">{n} comments</span>;
}

function BomMarks({ node }: { node: TreeNode }) {
  if (node.ahead)
    return (
      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-600" title="A newer Onshape version than the one the BOM is on: Update system hasn't brought it in yet">
        Newer in Onshape · BOM not updated
      </span>
    );
  if (!node.bom.length) return null;
  const current = node.bom.some((b) => b.current);
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${current ? "bg-emerald-500/15 text-emerald-600" : "bg-raised text-fg-2"}`} title={`BOM updated: ${node.bom.map((b) => b.label).join(", ")}`}>
      {current ? "BOM is on this" : "BOM updated"}
    </span>
  );
}

function NodeMeta({ node }: { node: TreeNode }) {
  if (!node.at && !node.by) return null;
  return (
    <span className="block text-[11px] text-subtle">
      {node.by ? `${node.by} · ` : ""}
      {node.at && <LocalTime at={node.at} />}
    </span>
  );
}

function NodeComments({ node, comments, onFocus }: { node: TreeNode; comments: Map<string, ReviewComment>; onFocus: (key: string) => void }) {
  const added = node.added.flatMap((id) => comments.get(id) ?? []);
  const done = node.done.flatMap((id) => comments.get(id) ?? []);
  if (!added.length && !done.length) return null;
  return (
    <div className="mt-1.5 space-y-1.5">
      {added.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-subtle uppercase">Comments added · {added.length}</p>
          <ul>
            {added.map((c) => (
              <TreeComment key={c.id} c={c} onFocus={onFocus} />
            ))}
          </ul>
        </div>
      )}
      {done.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-subtle uppercase">Ticked off · {done.length}</p>
          <ul>
            {done.map((c) => (
              <TreeComment key={c.id} c={c} onFocus={onFocus} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Reads the design's Onshape versions (1 call), for versions the BOM wasn't updated to yet.
function RefreshVersions({ systemId, readAt }: { systemId: string; readAt: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  return (
    <span className="flex flex-col items-end">
      <button
        className="press text-xs font-semibold text-accent-hover hover:underline disabled:opacity-60 pointer-coarse:min-h-9"
        disabled={state.busy}
        title="Read this design's Onshape versions (1 Onshape call)"
        onClick={async () => {
          setState({ busy: true });
          const res = await fetch(`/api/systems/${systemId}/onshape-versions`, { method: "POST" });
          const r = (await res.json().catch(() => ({ error: "The refresh failed." }))) as { error?: string };
          setState({ busy: false, error: r.error });
          if (!r.error) router.refresh();
        }}
      >
        {state.busy ? "Reading Onshape…" : "Refresh from Onshape"}
      </button>
      {state.error ? (
        <span className="text-[11px] text-rose-600">{state.error}</span>
      ) : (
        readAt && (
          <span className="text-[10px] text-subtle">
            read <LocalTime at={readAt} />
          </span>
        )
      )}
    </span>
  );
}
