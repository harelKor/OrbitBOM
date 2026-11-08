"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { SceneTools, ViewerModel, ViewerMode } from "@/components/dashboard/ModelCanvas";
import { AddCommentDialog, OpenComment, TreeComment, WaitingComment } from "@/components/review/Comments";
import { ViewerToolbar } from "@/components/review/ViewerToolbar";
import { LocalTime } from "@/components/ui/LocalTime";
import { Segmented } from "@/components/ui/Segmented";
import { UpdateSystem } from "@/components/versions/UpdateSystem";
import type { ReviewComment, SystemReview as Review } from "@/lib/data/cadReview";
import type { TreeNode } from "@/lib/reviews/tree";
import type { Draft } from "@/lib/versions/detect";

const ModelCanvas = dynamic(() => import("@/components/dashboard/ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });

type Part = { id: string; key: string; name: string };
type Colors = "cad" | "compare";

// Compare: what the BOM's current version changed (free: the version's own change list).
const COMPARE = { shape: "#f59e0b", props: "#38bdf8", added: "#22c55e", same: "#d5d9e1" };

// A system's CAD Review (Harel, 2026-11-08). Left: the current version big on top and the version
// tree, each version with the comments added while it was current and those ticked off at it,
// + Add comment and Update system. Right: the 3D view, its tools, and at its top right the open
// comments and, for mentors, those ticked off and waiting for approval. A tap on a part offers
// "Add comment"; a tap on a comment shows its part.
export function SystemReview({
  robotId,
  robotName,
  system,
  review,
  parts,
  thumbs,
  builtAt,
  draft,
  latest,
  me,
  canTick,
  canSync,
  canApprove,
}: {
  robotId: string;
  robotName: string;
  system: { id: string; name: string; assemblyUrl: string | null; lastSyncedAt: Date | null };
  review: Review;
  parts: Part[];
  thumbs: Record<string, string | null>;
  builtAt: string | null;
  draft: Draft | null;
  latest: { id: string; label: string } | null;
  me: { id: string; isAdmin: boolean; isMentor: boolean; onshape: boolean };
  canTick: boolean;
  canSync: boolean;
  canApprove: boolean; // a mentor, or an admin in Edit mode
}) {
  const [model, setModel] = useState<ViewerModel | null | undefined>(builtAt ? undefined : null);
  const [colors, setColors] = useState<Colors>("cad");
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [tools, setTools] = useState<SceneTools | null>(null);
  const [measured, setMeasured] = useState<{ points: number; mm: number | null }>({ points: 0, mm: null });
  const [measuring, setMeasuring] = useState(false);
  const [isolated, setIsolated] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ key: string; name: string | null } | null | false>(false);
  // null: as the screen suits (folded on a phone, open on wider screens) until toggled.
  const [openList, setOpenList] = useState<boolean | null>(null);
  const [waitList, setWaitList] = useState<boolean | null>(null);

  useEffect(() => {
    if (!builtAt) return;
    let cancelled = false;
    fetch(`/api/robots/${robotId}/model?system=${system.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { model: ViewerModel | null } | null) => !cancelled && setModel(d?.model ?? null))
      .catch(() => !cancelled && setModel(null));
    return () => {
      cancelled = true;
    };
  }, [robotId, system.id, builtAt]);

  const nameByKey = useMemo(() => new Map(parts.map((p) => [p.key, p.name])), [parts]);
  const keyById = useMemo(() => new Map(parts.map((p) => [p.id, p.key])), [parts]);
  const compareColors = useMemo(() => {
    const m = new Map<string, string>(parts.map((p) => [p.key, COMPARE.same]));
    for (const c of review.changes) {
      const key = c.partId ? keyById.get(c.partId) : undefined;
      if (key) m.set(key, c.change === "added" ? COMPARE.added : c.geometry ? COMPARE.shape : COMPARE.props);
    }
    return m;
  }, [parts, review.changes, keyById]);
  const removed = review.changes.filter((c) => c.change === "removed");
  const mode: ViewerMode = colors === "compare" ? "status" : "cad";

  const commentById = useMemo(() => new Map(review.comments.map((c) => [c.id, c])), [review.comments]);
  const open = review.comments.filter((c) => c.state === "open").reverse();
  const waiting = review.comments.filter((c) => c.state === "done");
  const onLocated = useCallback(() => {}, []);
  const showPart = (key: string) => {
    setSelected(null);
    setFocus((f) => (f === key ? null : key));
  };
  const onPick = (key: string | null) => {
    setFocus(null);
    setSelected(key);
  };
  const picked = selected ? { key: selected, name: nameByKey.get(selected) ?? null } : null;
  const size = picked && tools ? tools.partSize(picked.key) : null;
  const focusName = focus ? (nameByKey.get(focus) ?? review.comments.find((c) => c.partKey === focus)?.partName ?? "The part") : null;

  // Esc clears the picked or shown part (not while a window is open over the page).
  useEffect(() => {
    if (!selected && !focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      setSelected(null);
      setFocus(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, focus]);

  const panel = (
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-line p-4 lg:w-80 lg:shrink-0 lg:border-r xl:w-96">
      <div>
        <Link href={`/robots/${robotId}/cad-review`} className="text-sm text-subtle hover:text-fg">
          ← CAD Review · {robotName}
        </Link>
        <h1 className="display truncate text-3xl text-accent">{system.name}</h1>
        <Link href={`/robots/${robotId}/systems/${system.id}`} className="text-xs text-subtle hover:text-fg">
          Open the system&rsquo;s BOM
        </Link>
      </div>
      <button className="btn-primary h-12 w-full justify-center text-base shadow-[0_0_18px_-4px_var(--color-accent)] active:scale-[0.98]" onClick={() => setAdding(picked)}>
        + Add comment
      </button>
      {system.assemblyUrl && (canSync || draft) && (
        <Suspense>
          <UpdateSystem
            systemId={system.id}
            draft={draft}
            lastSyncedAt={system.lastSyncedAt}
            thumbs={thumbs}
            latest={latest}
            comments={open.map((c) => ({ id: c.id, body: c.body, partName: c.partName, author: c.author, createdAt: c.createdAt }))}
            phone
          />
        </Suspense>
      )}
      <VersionTree tree={review.tree} comments={commentById} onFocus={showPart} systemId={system.id} readAt={review.treeReadAt} canRefresh={canSync && me.onshape && !!review.treeDid} />
    </aside>
  );

  return (
    <div className="-m-4 flex flex-col md:-m-6 lg:h-[calc(100dvh-var(--topbar-h,2.75rem))] lg:flex-row">
      <div className="order-2 lg:order-1 lg:flex lg:min-h-0">{panel}</div>
      <section className="relative order-1 h-[62dvh] min-h-80 flex-1 overflow-hidden border-b border-line bg-surface lg:order-2 lg:h-auto lg:border-b-0">
        {model ? (
          <ModelCanvas
            model={model}
            colors={compareColors}
            mode={mode}
            locateKey={focus}
            onLocated={onLocated}
            selectedKey={selected}
            onPick={onPick}
            names={nameByKey}
            onTools={setTools}
            onMeasure={setMeasured}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
            {model === undefined ? "Loading the 3D view…" : "The 3D view shows here once the robot's 3D model is exported (Update 3D model on the robot page)."}
          </div>
        )}

        {/* Top right: open comments, and below them, for mentors, those waiting for approval. */}
        <div className="absolute top-3 right-3 z-10 flex max-h-[calc(100%-5rem)] w-[min(20rem,calc(100%-1.5rem))] flex-col gap-2 max-sm:w-52">
          <Popup title="Open comments" count={open.length} shown={openList} onToggle={() => setOpenList(flip(openList))} tone="amber">
            {open.length ? (
              open.map((c) => <OpenComment key={c.id} c={c} systemId={system.id} canTick={canTick} canDelete={me.isAdmin || c.authorId === me.id} onFocus={showPart} />)
            ) : (
              <li className="p-2 text-xs text-muted">No open comments.</li>
            )}
          </Popup>
          {canApprove && (
            <Popup title={me.isMentor ? "Waiting for you" : "Waiting for approval"} count={waiting.length} shown={waitList} onToggle={() => setWaitList(flip(waitList))} tone="sky">
              {waiting.length ? (
                waiting.map((c) => <WaitingComment key={c.id} c={c} systemId={system.id} isMentor canTick={canTick} onFocus={showPart} />)
              ) : (
                <li className="p-2 text-xs text-muted">Nothing ticked off to approve.</li>
              )}
            </Popup>
          )}
        </div>

        {/* The picked part: Add comment, hide, show alone, its size. */}
        {picked && (
          <div className="absolute top-3 left-3 z-20 flex w-max max-sm:top-auto max-sm:bottom-3 sm:max-w-[calc(100%-23rem)] max-w-[calc(100%-1.5rem)] animate-pop flex-wrap items-center gap-2 rounded-md border border-accent/50 bg-surface/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
            <span className="min-w-0 max-w-48 truncate font-semibold text-fg">{picked.name ?? "Placed in CAD, not on the BOM"}</span>
            {size && <span className="text-subtle tabular-nums">≈ {size.map((n) => Math.round(n)).join(" × ")} mm</span>}
            <button className="btn-primary h-8 px-3 text-xs active:scale-[0.98] pointer-coarse:h-9" onClick={() => setAdding(picked)}>
              Add comment
            </button>
            <button
              className="btn h-8 px-2.5 text-xs pointer-coarse:h-9"
              onClick={() => {
                tools?.hideKey(picked.key);
                setSelected(null);
              }}
            >
              Hide
            </button>
            <button
              className="btn h-8 px-2.5 text-xs pointer-coarse:h-9"
              onClick={() => {
                const next = isolated === picked.key ? null : picked.key;
                tools?.isolate(next);
                setIsolated(next);
              }}
            >
              {isolated === picked.key ? "Show all" : "Only this"}
            </button>
            <button onClick={() => setSelected(null)} className="press text-muted hover:text-fg pointer-coarse:min-h-9 pointer-coarse:min-w-9" aria-label="Clear selection" title="Clear (Esc)">
              ✕
            </button>
          </div>
        )}
        {(focusName || (isolated && !picked)) && (
          <div className="absolute top-3 left-3 z-20 flex animate-pop items-center max-sm:top-auto max-sm:bottom-3 gap-2 rounded-full border border-emerald-500/50 bg-surface/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur">
            <span className="font-semibold text-fg">{focusName ? `Showing ${focusName}` : "One part shown"}</span>
            <button
              onClick={() => {
                setFocus(null);
                tools?.isolate(null);
                setIsolated(null);
              }}
              className="press font-semibold text-accent-hover hover:underline pointer-coarse:min-h-9"
            >
              Show all
            </button>
          </div>
        )}
        {/* Bottom left: the colours (CAD, or what the current version changed) above the tools. */}
        <ViewerToolbar tools={tools} measured={measured} measuring={measuring} onMeasuring={setMeasuring}>
          <Segmented
            label="Part colours"
            value={colors}
            onChange={setColors}
            options={[
              { value: "cad", label: "CAD" },
              { value: "compare", label: review.current ? `Changes in ${review.current.label}` : "Changes" },
            ]}
          />
          {colors === "compare" && (
            <div className="rounded-md border border-line bg-surface/95 px-2.5 py-1.5 text-[11px] text-fg-2 shadow-sm backdrop-blur">
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <Dot c={COMPARE.shape}>Shape</Dot>
                <Dot c={COMPARE.props}>Properties</Dot>
                <Dot c={COMPARE.added}>Added</Dot>
              </div>
              {removed.length > 0 && <p className="mt-1 text-subtle">Removed: {removed.map((r) => r.name).join(", ")}</p>}
              {!review.changes.length && <p className="text-subtle">No changes in this version.</p>}
            </div>
          )}
        </ViewerToolbar>
      </section>
      {adding !== false && <AddCommentDialog open onClose={() => setAdding(false)} systemId={system.id} part={adding} onClearPart={() => setAdding(null)} />}
    </div>
  );
}

function Dot({ c, children }: { c: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-full" style={{ background: c }} />
      {children}
    </span>
  );
}

const phone = () => window.matchMedia("(max-width: 639px)").matches;
const flip = (shown: boolean | null) => (shown === null ? phone() : !shown);

function Popup({ title, count, shown, onToggle, tone, children }: { title: string; count: number; shown: boolean | null; onToggle: () => void; tone: "amber" | "sky"; children: React.ReactNode }) {
  const badge = tone === "amber" ? "bg-amber-500/15 text-amber-600" : "bg-sky-500/15 text-sky-600";
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface/95 shadow-md backdrop-blur">
      <button onClick={onToggle} className="press flex items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-fg hover:bg-raised pointer-coarse:min-h-11" aria-expanded={shown ?? undefined}>
        <span className="flex-1">{title}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${badge}`}>{count}</span>
        <span className={`text-xs text-subtle ${shown === null ? "max-sm:rotate-180" : shown ? "" : "rotate-180"}`}>▴</span>
      </button>
      {shown !== false && <ul className={`min-h-0 flex-1 overflow-y-auto border-t border-line p-1 ${shown === null ? "max-sm:hidden" : ""}`}>{children}</ul>}
    </div>
  );
}

// The version tree, like Onshape's: the newest version big on top, older ones down a line. A
// version the BOM was updated to carries a BOM mark.
function VersionTree({ tree, comments, onFocus, systemId, readAt, canRefresh }: { tree: TreeNode[]; comments: Map<string, ReviewComment>; onFocus: (key: string) => void; systemId: string; readAt: string | null; canRefresh: boolean }) {
  const [top, ...rest] = tree;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="label">Versions</h2>
        {canRefresh && <RefreshVersions systemId={systemId} readAt={readAt} />}
      </div>
      {!top ? (
        <p className="text-sm text-muted">No versions yet. Update system brings the first one.</p>
      ) : (
        <>
          <div className="rounded-lg border-2 border-accent/50 bg-accent/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-2xl font-bold text-accent tabular-nums">{top.name || "Unnamed"}</span>
              <BomMarks node={top} />
            </div>
            <NodeMeta node={top} />
            {top.description && <p className="mt-1 text-xs whitespace-pre-wrap text-fg-2">{top.description}</p>}
            <NodeComments node={top} comments={comments} onFocus={onFocus} />
          </div>
          {rest.length > 0 && (
            <ol className="relative ml-2 border-l-2 border-line">
              {rest.map((n) => (
                <li key={n.key} className="relative pb-3 pl-4">
                  <span className={`absolute top-1.5 -left-[7px] h-3 w-3 rounded-full border-2 border-surface ${n.bom.length ? "bg-accent" : "bg-line"}`} />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-fg tabular-nums">{n.name || "Unnamed"}</span>
                    <BomMarks node={n} />
                  </div>
                  <NodeMeta node={n} />
                  <NodeComments node={n} comments={comments} onFocus={onFocus} />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

function BomMarks({ node }: { node: TreeNode }) {
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
    <p className="text-[11px] text-subtle">
      {node.by ? `${node.by} · ` : ""}
      {node.at && <LocalTime at={node.at} />}
    </p>
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
