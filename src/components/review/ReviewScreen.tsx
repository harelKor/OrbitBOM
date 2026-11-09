"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openPartWindow } from "@/components/bom/PartDetailsHost";
import type { SceneTools, ViewerModel, ViewerMode } from "@/components/dashboard/ModelCanvas";
import { AddCommentDialog, OpenComment, WaitingComment, type CommentTarget } from "@/components/review/Comments";
import { ViewerToolbar } from "@/components/review/ViewerToolbar";
import { Segmented } from "@/components/ui/Segmented";
import type { ReviewComment } from "@/lib/data/cadReview";

const ModelCanvas = dynamic(() => import("@/components/dashboard/ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });

export type ReviewPart = { id: string; key: string; name: string; systemId: string | null };
type Colors = "cad" | "compare";

// Compare: what the BOM's current version changed (free: the version's own change list).
const COMPARE = { shape: "#f59e0b", props: "#38bdf8", added: "#22c55e", same: "#d5d9e1" };
export type Changes = { label: string | null; list: { partId: string | null; change: string; geometry: boolean; name: string }[] };

// CAD's review screen for a system or the whole robot (Harel, 2026-11-08 and 2026-11-09). Wide
// screens: the panel (title, + Add comment, Update system, the tree) on the left, the 3D view
// beside it. Phones: the 3D view fills the screen; Versions (top left) slides the panel in, Tools
// fold under it, + Add comment sits at the bottom. Top right: open comments and, for mentors and
// Edit mode, those waiting for approval. A tap on a part offers Add comment (and on the robot's
// page Open system); a second tap opens its BOM window. A tap on a comment shows its part.
export function ReviewScreen({
  robotId,
  title,
  back,
  modelUrl,
  builtAt,
  parts,
  comments,
  target,
  me,
  canTick,
  canApprove,
  changes,
  panel,
}: {
  robotId: string;
  title: string;
  back: { href: string; label: string };
  modelUrl: string;
  builtAt: string | null;
  parts: ReviewPart[];
  comments: ReviewComment[];
  target: CommentTarget;
  me: { id: string; isAdmin: boolean; isMentor: boolean };
  canTick: boolean;
  canApprove: boolean;
  changes?: Changes; // a system's: the Changes colours
  panel: (onFocus: (key: string) => void, openComments: ReviewComment[]) => React.ReactNode;
}) {
  const [model, setModel] = useState<ViewerModel | null | undefined>(builtAt ? undefined : null);
  const [colors, setColors] = useState<Colors>("cad");
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [tools, setTools] = useState<SceneTools | null>(null);
  const [measured, setMeasured] = useState<{ points: number; mm: number | null }>({ points: 0, mm: null });
  const [measuring, setMeasuring] = useState(false);
  const [isolated, setIsolated] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ key: string; name: string | null; systemId: string | null } | null | false>(false);
  const [drawer, setDrawer] = useState(false);
  // null: as the screen suits (folded on a phone, open on wider screens) until toggled.
  const [openList, setOpenList] = useState<boolean | null>(null);
  const [waitList, setWaitList] = useState<boolean | null>(null);
  const onRobot = "systems" in target;
  // The screen fills what's left under the top bar, which is two rows on a phone (taller than
  // --topbar-h): measured, and kept on resize. --review-top places the phone's Versions panel.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => {
      const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY);
      el.style.height = `${window.innerHeight - top}px`;
      el.style.setProperty("--review-top", `${top}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    if (!builtAt) return;
    let cancelled = false;
    fetch(modelUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { model: ViewerModel | null } | null) => !cancelled && setModel(d?.model ?? null))
      .catch(() => !cancelled && setModel(null));
    return () => {
      cancelled = true;
    };
  }, [modelUrl, builtAt]);

  const partByKey = useMemo(() => new Map(parts.map((p) => [p.key, p])), [parts]);
  const nameByKey = useMemo(() => new Map(parts.map((p) => [p.key, p.name])), [parts]);
  const compareColors = useMemo(() => {
    const m = new Map<string, string>(parts.map((p) => [p.key, COMPARE.same]));
    const keyById = new Map(parts.map((p) => [p.id, p.key]));
    for (const c of changes?.list ?? []) {
      const key = c.partId ? keyById.get(c.partId) : undefined;
      if (key) m.set(key, c.change === "added" ? COMPARE.added : c.geometry ? COMPARE.shape : COMPARE.props);
    }
    return m;
  }, [parts, changes]);
  const removed = changes?.list.filter((c) => c.change === "removed") ?? [];
  const mode: ViewerMode = colors === "compare" ? "status" : "cad";

  const open = comments.filter((c) => c.state === "open").reverse();
  const waiting = comments.filter((c) => c.state === "done");
  const onLocated = useCallback(() => {}, []);
  const showPart = useCallback((key: string) => {
    setSelected(null);
    setDrawer(false);
    setFocus((f) => (f === key ? null : key));
  }, []);
  // A second tap on the picked part opens its BOM window, as in the other 3D views.
  const onPick = (key: string | null) => {
    setFocus(null);
    const part = key ? partByKey.get(key) : undefined;
    if (key && key === selected && part) void openPartWindow(part.id);
    else setSelected(key);
  };
  const pickedPart = selected ? partByKey.get(selected) : undefined;
  const picked = selected ? { key: selected, name: pickedPart?.name ?? null, systemId: pickedPart?.systemId ?? null } : null;
  const size = picked && tools ? tools.partSize(picked.key) : null;
  const focusName = focus ? (nameByKey.get(focus) ?? comments.find((c) => c.partKey === focus)?.partName ?? "The part") : null;

  // Esc closes the panel on a phone, then clears the picked or shown part (not under a window).
  useEffect(() => {
    if (!selected && !focus && !drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (drawer) return setDrawer(false);
      setSelected(null);
      setFocus(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, focus, drawer]);

  return (
    <div ref={root} className="-m-4 flex h-[calc(100dvh-var(--topbar-h,2.75rem))] md:-m-6">
      {drawer && <button aria-label="Close versions" onClick={() => setDrawer(false)} className="fixed inset-0 z-30 modal-backdrop lg:hidden" />}
      <aside
        className={`flex min-h-0 flex-col gap-4 overflow-y-auto border-line bg-surface p-4 lg:w-80 lg:shrink-0 lg:border-r xl:w-96 max-lg:fixed max-lg:top-[var(--review-top,2.75rem)] max-lg:bottom-0 max-lg:left-0 max-lg:z-40 max-lg:w-[min(22rem,88vw)] max-lg:border-r max-lg:shadow-xl ${drawer ? "max-lg:animate-pop" : "max-lg:hidden"}`}
      >
        <div className="max-lg:hidden">
          <Link href={back.href} className="text-sm text-subtle hover:text-fg">
            ← {back.label}
          </Link>
          <h1 className="display truncate text-3xl text-accent">{title}</h1>
        </div>
        <button className="btn-primary h-12 w-full justify-center text-base shadow-[0_0_18px_-4px_var(--color-accent)] active:scale-[0.98] max-lg:hidden" onClick={() => setAdding(picked)}>
          + Add comment
        </button>
        {panel(showPart, open)}
      </aside>

      <section className="relative min-w-0 flex-1 overflow-hidden bg-surface">
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

        {/* Phones: the panel behind a Versions button, top left. */}
        <button onClick={() => setDrawer(true)} className="press absolute top-3 left-3 z-10 h-10 rounded-md border border-line bg-surface/95 px-3 text-sm font-semibold text-fg shadow-sm backdrop-blur active:scale-[0.98] lg:hidden">
          ☰ Versions
        </button>

        {/* Top right: open comments, and below them those waiting for approval. */}
        <div className="absolute top-3 right-3 z-10 flex max-h-[calc(100%-5rem)] w-[min(20rem,calc(100%-1.5rem))] flex-col gap-2 max-sm:w-48">
          <Popup title="Open comments" count={open.length} shown={openList} onToggle={() => setOpenList(flip(openList))} tone="amber">
            {open.length ? (
              open.map((c) => <OpenComment key={c.id} c={c} canTick={canTick} canDelete={me.isAdmin || c.authorId === me.id} onFocus={showPart} where={onRobot} />)
            ) : (
              <li className="p-2 text-xs text-muted">No open comments.</li>
            )}
          </Popup>
          {canApprove && (
            <Popup title={me.isMentor ? "Waiting for you" : "Waiting for approval"} count={waiting.length} shown={waitList} onToggle={() => setWaitList(flip(waitList))} tone="sky">
              {waiting.length ? (
                waiting.map((c) => <WaitingComment key={c.id} c={c} isMentor canTick={canTick} onFocus={showPart} where={onRobot} />)
              ) : (
                <li className="p-2 text-xs text-muted">Nothing ticked off to approve.</li>
              )}
            </Popup>
          )}
        </div>

        {/* The picked part: Add comment, Open system (the robot's page), hide, show alone, size. */}
        {picked && (
          <div className="absolute z-20 flex w-max max-w-[calc(100%-1.5rem)] animate-pop flex-wrap items-center gap-2 rounded-md border border-accent/50 bg-surface/95 px-3 py-2 text-xs shadow-sm backdrop-blur max-lg:bottom-20 max-lg:left-1/2 max-lg:-translate-x-1/2 max-lg:justify-center lg:top-3 lg:left-3 lg:max-w-[calc(100%-23rem)]">
            <span className="min-w-0 max-w-48 truncate font-semibold text-fg">{picked.name ?? "Placed in CAD, not on the BOM"}</span>
            {size && <span className="text-subtle tabular-nums">≈ {size.map((n) => Math.round(n)).join(" × ")} mm</span>}
            <button className="btn-primary h-8 px-3 text-xs active:scale-[0.98] pointer-coarse:h-9" onClick={() => setAdding(picked)}>
              Add comment
            </button>
            {onRobot && picked.systemId && (
              <Link href={`/robots/${robotId}/systems/${picked.systemId}/cad-review`} className="btn h-8 px-2.5 text-xs pointer-coarse:h-9">
                Open system
              </Link>
            )}
            {pickedPart && (
              <button className="btn h-8 px-2.5 text-xs pointer-coarse:h-9" onClick={() => void openPartWindow(pickedPart.id)} title="Or tap the part again">
                Open part
              </button>
            )}
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
        {!picked && (focusName || isolated) && (
          <div className="absolute z-20 flex animate-pop items-center gap-2 rounded-full border border-emerald-500/50 bg-surface/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur max-lg:bottom-20 max-lg:left-1/2 max-lg:-translate-x-1/2 lg:top-3 lg:left-3">
            <span className="font-semibold whitespace-nowrap text-fg">{focusName ? `Showing ${focusName}` : "One part shown"}</span>
            <button
              onClick={() => {
                setFocus(null);
                tools?.isolate(null);
                setIsolated(null);
              }}
              className="press font-semibold whitespace-nowrap text-accent-hover hover:underline pointer-coarse:min-h-9"
            >
              Show all
            </button>
          </div>
        )}

        {/* Phones: + Add comment at the bottom. */}
        <button
          className="btn-primary absolute bottom-4 left-1/2 z-10 h-12 -translate-x-1/2 px-6 text-base shadow-[0_0_18px_-4px_var(--color-accent)] active:scale-[0.98] lg:hidden"
          onClick={() => setAdding(picked)}
        >
          + Add comment
        </button>

        <ViewerToolbar tools={tools} measured={measured} measuring={measuring} onMeasuring={setMeasuring}>
          {changes && (
            <>
              <Segmented
                label="Part colours"
                value={colors}
                onChange={setColors}
                options={[
                  { value: "cad", label: "CAD" },
                  { value: "compare", label: changes.label ? `Changes in ${changes.label}` : "Changes" },
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
                  {!changes.list.length && <p className="text-subtle">No changes in this version.</p>}
                </div>
              )}
            </>
          )}
        </ViewerToolbar>
      </section>
      {adding !== false && <AddCommentDialog open onClose={() => setAdding(false)} robotId={robotId} target={target} part={adding} onClearPart={() => setAdding(null)} />}
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
        <span className="flex-1 truncate">{title}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${badge}`}>{count}</span>
        <span className={`text-xs text-subtle ${shown === null ? "max-sm:rotate-180" : shown ? "" : "rotate-180"}`}>▴</span>
      </button>
      {shown !== false && <ul className={`min-h-0 flex-1 overflow-y-auto border-t border-line p-1 ${shown === null ? "max-sm:hidden" : ""}`}>{children}</ul>}
    </div>
  );
}
