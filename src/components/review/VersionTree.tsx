"use client";

import { CALL_COSTS, costHint } from "@/config/callCosts";
import { useRouter } from "next/navigation";
import { useContext, useState } from "react";
import { deleteTreeVersion, removeRobotVersion, versionDraft } from "@/app/(app)/robots/[robotId]/cad-review/versionActions";
import { Popover } from "@/components/bom/Popover";
import { TreeComment } from "@/components/review/Comments";
import { LocalTime } from "@/components/ui/LocalTime";
import { toast } from "@/components/ui/Toaster";
import { askConfirm } from "@/components/ui/useConfirm";
import { CommitWindow } from "@/components/versions/CommitWindow";
import type { ReviewComment } from "@/lib/data/cadReview";
import type { TreeNode } from "@/lib/reviews/tree";
import { flatVersions, onshapeUrlOf, previousOf, type OnshapeLink, type VersionItem } from "@/lib/reviews/versionList";
import type { Draft } from "@/lib/versions/detect";
import { VersionContext, type Entry, type VersionPick } from "./versionView";
import { safeAction } from "@/lib/safeAction";

// Whose tree it is: a system's (its Final or Basepart), the robot's own Basepart, or the whole
// robot's own versions (Create version: each node is every system at that moment).
export type TreeOwner = { systemId: string } | { robotBasepart: true } | { robot: Map<string, Entry[]> };

// The version tree, like Onshape's: the newest version big on top, older ones down a line. A
// version the BOM was updated to carries a BOM mark. A tap on a version shows it in 3D, its
// changes coloured (Harel, 2026-11-17); ▾ folds its comments; ⋮ has Compare, Commit window and
// Delete version.
export function VersionTree({
  tree,
  comments,
  onFocus,
  refresh,
  empty = "No versions yet. Update system brings the first one.",
  owner,
  did = null,
  onshape = null,
  current = null,
}: {
  tree: TreeNode[];
  comments: Map<string, ReviewComment>;
  onFocus: (key: string) => void;
  refresh?: { systemId: string; readAt: string | null } | null; // the Refresh from Onshape button
  empty?: string; // what an empty tree says
  owner?: TreeOwner; // without it the tree only lists (no visiting)
  did?: string | null; // the tree's Onshape document (Delete version)
  onshape?: OnshapeLink | null; // the assembly its versions open in (Open in Onshape)
  current?: VersionPick | null; // what the 3D model is on now (Compare's other side)
}) {
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const list = flatVersions(tree);
  const [top, ...rest] = tree;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="label">Versions</h2>
        {refresh && <RefreshVersions systemId={refresh.systemId} readAt={refresh.readAt} />}
      </div>
      {!top ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <>
          <div className="rounded-lg border-2 border-accent/50 bg-accent/5 p-3">
            <NodeHead node={top} list={list} owner={owner} did={did} onshape={onshape} current={current} big folded={folded.has(top.key)} onFold={() => toggle(top.key)} />
            {!folded.has(top.key) && (
              <>
                {top.description && <p className="mt-1 text-xs whitespace-pre-wrap text-fg-2">{top.description}</p>}
                <NodeComments node={top} comments={comments} onFocus={onFocus} />
              </>
            )}
            <SubVersions node={top} newest list={list} owner={owner} did={did} onshape={onshape} current={current} />
          </div>
          {rest.length > 0 && (
            <ol className="relative ml-2 border-l-2 border-line">
              {rest.map((n) => (
                <li key={n.key} className="relative pb-3 pl-4">
                  <span className={`absolute top-1.5 -left-[7px] h-3 w-3 rounded-full border-2 border-surface ${n.bom.length ? "bg-accent" : "bg-line"}`} />
                  <NodeHead node={n} list={list} owner={owner} did={did} onshape={onshape} current={current} folded={folded.has(n.key)} onFold={() => toggle(n.key)} />
                  {!folded.has(n.key) && (
                    <>
                      {n.description && <p className="mt-1 text-xs whitespace-pre-wrap text-fg-2">{n.description}</p>}
                      <NodeComments node={n} comments={comments} onFocus={onFocus} />
                    </>
                  )}
                  <SubVersions node={n} newest={false} list={list} owner={owner} did={did} onshape={onshape} current={current} />
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

const ownerKey = (owner: TreeOwner) => ("systemId" in owner ? owner.systemId : "robot");

// A version as the CAD page draws it: its own state, or for a robot version every system's.
function pickOf(item: VersionItem, owner: TreeOwner | undefined): VersionPick | null {
  if (!owner) return null;
  if ("robot" in owner) {
    const entries = owner.robot.get(item.key);
    return entries?.length ? { key: item.key, label: item.label, at: item.at, entries } : null;
  }
  return item.ref ? { key: item.key, label: item.label, at: item.at, entries: [{ owner: ownerKey(owner), ref: item.ref }] } : null;
}

function prevPick(list: VersionItem[], key: string, owner: TreeOwner | undefined): VersionPick | null {
  if (owner && "robot" in owner) {
    const i = list.findIndex((x) => x.key === key);
    for (let j = i - 1; j >= 0; j--) {
      const p = pickOf(list[j], owner);
      if (p) return p;
    }
    return null;
  }
  const prev = previousOf(list, key);
  return prev ? pickOf(prev, owner) : null;
}

type RowProps = { list: VersionItem[]; owner?: TreeOwner; did: string | null; onshape?: OnshapeLink | null; current: VersionPick | null };

// The version the 3D view is on now (the same state for every system it draws): pressing it does
// nothing there (Harel, 2026-11-18); while another version is shown it goes back.
function isCurrent(pick: VersionPick | null, current: VersionPick | null): boolean {
  if (!pick || !current || pick.entries.length !== current.entries.length) return false;
  return pick.entries.every((e) => current.entries.some((c) => c.owner === e.owner && c.ref.wvm === e.ref.wvm && c.ref.wvmid === e.ref.wvmid));
}

function NodeHead({ node, list, owner, did, onshape, current, big = false, folded, onFold }: RowProps & { node: TreeNode; big?: boolean; folded: boolean; onFold: () => void }) {
  const ctx = useContext(VersionContext);
  const item = list.find((x) => x.key === node.key)!;
  const pick = pickOf(item, owner);
  const viewing = ctx?.target?.a.key === node.key && ctx.target.mode === "visit";
  const here = isCurrent(pick, current);
  const n = node.added.length + node.done.length;
  return (
    <div className="flex items-start gap-1">
      <button
        className={`press -mx-1 block min-w-0 flex-1 rounded px-1 text-left pointer-coarse:min-h-9 disabled:cursor-default ${pick && !(here && !ctx?.target) ? "hover:bg-raised" : ""} ${viewing ? "bg-accent/15 ring-2 ring-accent/60" : ""}`}
        disabled={here && !ctx?.target}
        onClick={() => (here && ctx ? ctx.show(null) : pick && ctx ? ctx.show({ mode: "visit", a: pick, b: prevPick(list, node.key, owner) }) : onFold())}
        title={here ? (ctx?.target ? "Back to this version, the one the 3D view is on" : "The 3D view is on this version") : pick ? "Show this version in 3D" : undefined}
        aria-pressed={viewing}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className={big ? "font-mono text-2xl font-bold text-accent tabular-nums" : "font-mono text-sm font-semibold text-fg tabular-nums"}>{node.name || "Unnamed"}</span>
          <BomMarks node={node} />
          {viewing && <span className="rounded-full bg-accent px-2 py-0.5 text-[0.625rem] font-bold text-white">Viewing</span>}
        </span>
        <NodeMeta node={node} />
      </button>
      {n > 0 && (
        <button onClick={onFold} aria-expanded={!folded} className="press flex h-8 shrink-0 items-center gap-1 rounded-md px-1.5 text-[0.6875rem] text-fg-2 hover:bg-raised pointer-coarse:h-9" title={folded ? "Show its comments" : "Fold its comments"}>
          <span className="tabular-nums">💬 {n}</span>
          <span aria-hidden className={`inline-block transition-transform ${folded ? "" : "rotate-180"}`}>
            ▾
          </span>
        </button>
      )}
      <VersionMenu item={item} pick={pick} list={list} owner={owner} did={did} onshape={onshape} current={current} bomVersionId={node.bom.at(-1)?.id ?? null} subIds={node.subs.map((s) => s.id)} />
    </div>
  );
}

// ⋮ on a version (Harel, 2026-11-17).
function VersionMenu({ item, pick, list, owner, did, onshape, current, bomVersionId, subIds = [] }: RowProps & { item: VersionItem; pick: VersionPick | null; bomVersionId: string | null; subIds?: string[] }) {
  const ctx = useContext(VersionContext);
  const router = useRouter();
  const [bom, setBom] = useState<Draft | null>(null);
  if (!ctx || !owner) return null;
  const systemId = "systemId" in owner ? owner.systemId : null;
  const robotId = ctx.robotId;
  // Compare puts the version being viewed (else the current one) over this one.
  const base = ctx.target?.mode === "visit" ? ctx.target.a : current;
  const compare = pick && base && base.key !== pick.key ? () => ctx.show(newerFirst(base, pick)) : null;
  const commit =
    bomVersionId && systemId && ctx.kind === "final"
      ? async () => {
          const r = await safeAction(() => versionDraft(systemId, bomVersionId));
          if (r.error || !r.draft) return toast(r.error ?? "That version is gone.", true);
          setBom(r.draft);
        }
      : pick
        ? () => ctx.show({ mode: "visit", a: pick, b: prevPick(list, item.key, owner), commit: true })
        : null;
  const remove = ctx.canDelete
    ? async () => {
        const what = item.bomIds.length ? " Its BOM version goes too: part states only it had move to the next version." : "";
        if (!(await askConfirm({ title: `Delete ${item.label}?`, body: `It goes from OrbitParts only (Onshape keeps its own versions).${what} This can't be undone.`, confirm: "Delete", danger: true }))) return;
        const r =
          "robot" in owner
            ? await safeAction(() => removeRobotVersion(robotId, item.key.replace(/^rv:/, "")))
            : await safeAction(() =>
                deleteTreeVersion(robotId, {
                  owner: systemId ? { systemId } : { robotId },
                  kind: ctx.kind,
                  did: item.vid ? did : null,
                  vid: item.vid,
                  bomIds: item.bomIds,
                  subIds: item.subId ? [item.subId] : subIds,
                  ref: item.ref,
                }),
              );
        if (r.error) return toast(r.error, true);
        if (ctx.target && (ctx.target.a.key === item.key || ctx.target.b?.key === item.key)) ctx.show(null);
        toast(`${item.label} deleted`);
        router.refresh();
      }
    : null;
  const link = onshapeUrlOf(item, did, onshape);
  const items = [
    ...(link ? [{ label: "Open in Onshape", run: () => void window.open(link, "_blank", "noopener") }] : []),
    ...(compare ? [{ label: `Compare with ${base!.label}`, run: compare }] : []),
    ...(commit ? [{ label: "Commit window", run: () => void commit() }] : []),
    ...(remove ? [{ label: "Delete version", danger: true, run: () => void remove() }] : []),
  ];
  if (!items.length) return null;
  return (
    <>
      <Popover
        align="right"
        hideCaret
        width={210}
        triggerClassName="press flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-raised hover:text-fg pointer-coarse:h-9 pointer-coarse:w-9"
        trigger={
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-label={`${item.label}: more`}>
            <circle cx="8" cy="3" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="8" cy="13" r="1.5" />
          </svg>
        }
      >
        {(close) => (
          <ul className="text-sm">
            {items.map((it) => (
              <li key={it.label}>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    it.run();
                  }}
                  className={`flex min-h-9 w-full items-center rounded-md px-2.5 py-1.5 text-left hover:bg-raised active:scale-[0.98] ${"danger" in it && it.danger ? "text-rose-600" : "text-fg-2"}`}
                >
                  {it.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
      {bom && systemId && (
        <CommitWindow open onClose={() => setBom(null)} systemId={systemId} draft={bom} thumbs={{}} canCommit={false} committing={false} error={null} onCommit={() => {}} title={`Commit window · ${item.label}`} />
      )}
    </>
  );
}

// Compare: the newer version is `a` (green), the older `b` (yellow); the current one counts as newest.
function newerFirst(x: VersionPick, y: VersionPick) {
  const t = (p: VersionPick) => (p.key === "current" ? "9999" : (p.at ?? ""));
  return t(x) >= t(y) ? { mode: "compare" as const, a: x, b: y } : { mode: "compare" as const, a: y, b: x };
}

// Update CAD's sub-versions of a version ("V12 v1", Harel 2026-11-11): a small branch off it.
// Open on the newest version, where work goes on; once a newer Onshape version exists, the branch
// folds into its version and opens with a tap.
function SubVersions({ node, newest, list, owner, did, onshape, current }: RowProps & { node: TreeNode; newest: boolean }) {
  const ctx = useContext(VersionContext);
  const [open, setOpen] = useState(newest);
  if (!node.subs.length) return null;
  const n = node.subs.length;
  return (
    <div className="mt-1.5 ml-1">
      <button className="press flex items-center gap-1 text-[0.6875rem] font-semibold text-violet-600 pointer-coarse:min-h-9" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span aria-hidden className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        {n} sub-version{n === 1 ? "" : "s"}
      </button>
      {open && (
        <ol className="mt-1 ml-1.5 border-l-2 border-dashed border-violet-500/40">
          {[...node.subs].reverse().map((s) => {
            const item = list.find((x) => x.key === `sub:${s.id}`)!;
            const pick = pickOf(item, owner);
            const viewing = ctx?.target?.mode === "visit" && ctx.target.a.key === item.key;
            const here = isCurrent(pick, current);
            return (
              <li key={s.id} className="relative flex items-start gap-1 py-0.5 pl-3">
                <span className="absolute top-2 -left-[5px] h-2 w-2 rounded-full bg-violet-500/70" aria-hidden />
                <button
                  className={`press -mx-1 min-w-0 flex-1 rounded px-1 text-left pointer-coarse:min-h-9 ${pick ? "hover:bg-raised" : ""} ${viewing ? "bg-accent/15 ring-2 ring-accent/60" : ""}`}
                  disabled={!pick || !ctx || (here && !ctx.target)}
                  onClick={() => (here ? ctx?.show(null) : pick && ctx?.show({ mode: "visit", a: pick, b: prevPick(list, item.key, owner) }))}
                  title={here ? (ctx?.target ? "Back to this version, the one the 3D view is on" : "The 3D view is on this version") : pick ? "Show this version in 3D" : undefined}
                >
                  <span className="font-mono text-xs font-semibold text-fg tabular-nums">{s.label}</span>
                  <span className="block text-[0.625rem] text-subtle">
                    {s.by ? `${s.by} · ` : ""}
                    <LocalTime at={s.at} />
                  </span>
                </button>
                <VersionMenu item={item} pick={pick} list={list} owner={owner} did={did} onshape={onshape} current={current} bomVersionId={null} />
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function BomMarks({ node }: { node: TreeNode }) {
  if (node.ahead)
    return (
      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.6875rem] font-semibold text-amber-600" title="A newer Onshape version than the one the BOM is on: Update system hasn't brought it in yet">
        Newer in Onshape · BOM not updated
      </span>
    );
  if (!node.bom.length) return null;
  const current = node.bom.some((b) => b.current);
  return (
    <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${current ? "bg-emerald-500/15 text-emerald-600" : "bg-raised text-fg-2"}`} title={`BOM updated: ${node.bom.map((b) => b.label).join(", ")}`}>
      {current ? "BOM is on this" : "BOM updated"}
    </span>
  );
}

function NodeMeta({ node }: { node: TreeNode }) {
  if (!node.at && !node.by) return null;
  return (
    <span className="block text-[0.6875rem] text-subtle">
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
          <p className="text-[0.625rem] font-semibold tracking-wide text-subtle uppercase">Comments added · {added.length}</p>
          <ul>
            {added.map((c) => (
              <TreeComment key={c.id} c={c} onFocus={onFocus} />
            ))}
          </ul>
        </div>
      )}
      {done.length > 0 && (
        <div>
          <p className="text-[0.625rem] font-semibold tracking-wide text-subtle uppercase">Checked · {done.length}</p>
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
        title="Read this design's Onshape versions"
        {...costHint(CALL_COSTS.refreshVersions)}
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
        <span className="text-[0.6875rem] text-rose-600">{state.error}</span>
      ) : (
        readAt && (
          <span className="text-[0.625rem] text-subtle">
            read <LocalTime at={readAt} />
          </span>
        )
      )}
    </span>
  );
}
