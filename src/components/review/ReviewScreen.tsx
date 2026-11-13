"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openPartWindow } from "@/components/bom/PartDetailsHost";
import { deleteReviewView, saveReviewView } from "@/app/(app)/review-comments-actions";
import type { HiddenParts, MeasureInfo, NamedViews, PageMenu, SceneTools, ViewerModel, ViewerMode } from "@/components/dashboard/ModelCanvas";
import { AddCommentDialog, CommentContext, CommentRow, CommentWindow, useStickyList, type CommentTarget } from "@/components/review/Comments";
import { isActive, statusOf } from "@/lib/reviews/status";
import { SnipEditor, SnipMe, SnipOverlay, type SnipDraft } from "@/components/review/Snip";
import { ViewerToolbar } from "@/components/review/ViewerToolbar";
import { DesignCheck, type Finding } from "@/components/check/DesignCheck";
import { hideOverlap, markFinding, showOverlap } from "@/components/check/showOverlap";
import type { Clash, DesignFinding } from "@/lib/check/types";
import { MeasureBox } from "@/components/viewer/MeasureBox";
import { applyView, captureView, cleanView, hashWithView, viewFromHash, type ViewState } from "@/components/viewer/viewState";
import { Segmented } from "@/components/ui/Segmented";
import { ModelToggle, type ModelKind } from "@/components/dashboard/ModelToggle";
import type { ReviewComment } from "@/lib/data/cadReview";

const ModelCanvas = dynamic(() => import("@/components/dashboard/ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });

export type ReviewPart = { id: string; key: string; name: string; systemId: string | null; onshape?: string };
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
  onlySystem = null,
  onIsolate,
  panel,
  models,
  check,
}: {
  robotId: string;
  title: string;
  back?: { label: string; href?: string; onClick?: () => void };
  modelUrl: string;
  builtAt: string | null;
  parts: ReviewPart[];
  comments: ReviewComment[];
  target: CommentTarget;
  me: { id: string; isAdmin: boolean; isMentor: boolean };
  canTick: boolean;
  canApprove: boolean;
  changes?: Changes; // a system's: the Changes colours
  onlySystem?: string | null; // the robot's page with one system isolated: only its parts drawn
  onIsolate?: (systemId: string) => void; // the robot's page: Isolate on each system's comments
  panel: (onFocus: (key: string) => void, openComments: ReviewComment[]) => React.ReactNode;
  // The Basepart and Final 3D models (Harel, 2026-11-12): which one shows, whether both exist (the
  // toggle), and switching. Comments of both are listed; a tap on one written on the other model
  // switches to it, at its view.
  models?: { kind: ModelKind; both: boolean; onKind: (k: ModelKind) => void };
  // The Design check (plan/design-check.md): the robot's systems, and who may run it and set its limits.
  // `parts`: the whole robot's, also when one system is isolated (a run covers the robot).
  check?: { systems: { id: string; name: string }[]; parts: ReviewPart[]; canCheck: boolean; canManage: boolean };
}) {
  const kind: ModelKind = models?.kind ?? "final";
  const [model, setModel] = useState<ViewerModel | null | undefined>(builtAt ? undefined : null);
  const [colors, setColors] = useState<Colors>("cad");
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [tools, setTools] = useState<SceneTools | null>(null);
  const [measured, setMeasured] = useState<MeasureInfo>({ picks: [], rows: [], parts: [] });
  const [isolated, setIsolated] = useState<string[] | null>(null);
  const [adding, setAdding] = useState<{ key: string; name: string | null; systemId: string | null } | null | false>(false);
  const [drawer, setDrawer] = useState(false);
  // Snip (Harel, 2026-11-10): the comment window steps aside while a rectangle is dragged over the
  // view, then the drawing window (no flash, Harel 2026-11-10); Confirm brings the comment window
  // back with it.
  const [snipStep, setSnipStep] = useState<"drag" | "draw" | null>(null);
  const [snipDraft, setSnipDraft] = useState<SnipDraft | null>(null);
  const section = useRef<HTMLElement>(null);
  const takeSnip = (r: { x: number; y: number; w: number; h: number }) => {
    const bg = section.current ? getComputedStyle(section.current).backgroundColor : "#151925";
    const shot = tools?.snapshot(r, bg);
    if (!shot) return setSnipStep(null);
    setSnipDraft({ dataUrl: shot.dataUrl, w: shot.w, h: shot.h, strokes: [] });
    setSnipStep("draw");
  };
  const closeAdding = () => {
    setAdding(false);
    setSnipDraft(null);
  };
  // + Add comment keeps the 3D view as it is when the window opens, and the newest pick's point
  // as the comment's pin (S6).
  const [addingAt, setAddingAt] = useState<{ view: ViewState; pin: [number, number, number] | null } | null>(null);
  const [addingBody, setAddingBody] = useState("");
  const startAdding = (part: { key: string; name: string | null; systemId: string | null } | null, from?: { body: string; pin: [number, number, number] | null }) => {
    setAddingAt(tools ? { view: captureView(tools, changes ? colors : undefined), pin: from ? from.pin : tools.pickPoint() } : null);
    setAddingBody(from?.body ?? "");
    setAdding(part);
  };
  const [hidden, setHidden] = useState<HiddenParts | null>(null);
  // null: as the screen suits (folded on a phone, open on wider screens) until toggled.
  // Wide screens: the comments column folds sideways to a thin strip (Harel, 2026-11-11).
  const [side, setSide] = useState(true);
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

  // Points, edges and faces are picked at all times, like Onshape (Harel, 2026-11-09).
  useEffect(() => {
    tools?.measure("any");
  }, [tools]);

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
  const checkParts = check?.parts ?? parts;
  const systemsOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of checkParts) if (p.systemId) m.set(p.key, [...(m.get(p.key) ?? []), p.systemId]);
    return m;
  }, [checkParts]);
  const checkNames = useMemo(() => new Map(checkParts.map((p) => [p.key, p.name])), [checkParts]);
  // A Design check finding: its parts alone in the view (the rest see-through round them), framed.
  // Show on an overlap: the red stays until Isolate ends or changes (Show all, Esc, another Show).
  const overlapKeys = useRef<string[] | null>(null);
  const [overlapOn, setOverlapOn] = useState(false);
  const endOverlap = () => {
    if (tools && overlapKeys.current) hideOverlap(tools, overlapKeys.current);
    overlapKeys.current = null;
    setOverlapOn(false);
  };
  const onIsolatedChange = (keys: string[] | null) => {
    setIsolated(keys);
    const was = overlapKeys.current;
    if (was && (!keys || [...keys].sort().join() !== [...was].sort().join())) endOverlap();
  };
  const showClashOverlap = (c: Clash) => {
    if (!tools) return;
    endOverlap();
    setDrawer(false);
    setFocus(null);
    overlapKeys.current = [...new Set([c.a, c.b])];
    showOverlap(tools, c);
    setOverlapOn(true);
  };
  const markCheckFinding = (f: DesignFinding) => {
    if (!tools) return;
    endOverlap();
    setDrawer(false);
    setFocus(null);
    overlapKeys.current = [...new Set(f.keys)];
    markFinding(tools, f);
    setOverlapOn(true);
  };
  const showFinding = (f: Finding) => {
    if (!tools) return;
    endOverlap();
    setDrawer(false);
    setFocus(null);
    tools.isolate(f.keys, { ghost: 0.35 });
    tools.zoomTo(f.keys);
  };
  const commentFinding = (f: Finding) => {
    showFinding(f);
    // The comment keeps the view once the camera got there.
    window.setTimeout(() => startAdding(f.key ? { key: f.key, name: f.name, systemId: f.systemId } : null, { body: f.body, pin: f.pin }), 700);
  };
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
  const mode: ViewerMode = changes && colors === "compare" ? "status" : "cad";
  // Isolate on the robot's page (Harel, 2026-11-10): the other systems' groups aren't drawn, and
  // the view frames what's left.
  const hiddenGroups = useMemo(() => {
    if (!model || !onlySystem) return NO_GROUPS;
    return new Set((model.groups ?? []).flatMap((g, i) => (g.systemIds.includes(onlySystem) ? [] : [i])));
  }, [model, onlySystem]);
  useEffect(() => {
    tools?.view("fit");
  }, [tools, hiddenGroups]);

  // The view in the URL hash (S6): put back on load (after the Fit above), then kept up to date,
  // so a reload keeps it and the link shares it. Written only once every part is in, so a view
  // still being put back isn't overwritten half done.
  const colorsRef = useRef<string | undefined>(undefined);
  const writeHash = useRef<(() => void) | null>(null);
  useEffect(() => {
    colorsRef.current = changes ? colors : undefined;
    writeHash.current?.();
  }, [colors, changes, hidden, isolated]);
  useEffect(() => {
    if (!tools) return;
    const v = viewFromHash();
    if (v) {
      applyView(tools, v, false);
      const c = v.colors;
      if (c === "cad" || c === "compare") void Promise.resolve().then(() => setColors(c));
    }
    let live = true;
    let timer = 0;
    const write = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => live && history.replaceState(history.state, "", location.pathname + location.search + hashWithView(captureView(tools, colorsRef.current))), 400);
    };
    void tools.whenLoaded().then(() => {
      if (!live) return;
      writeHash.current = write;
      write();
    });
    const unWatch = tools.watch(() => writeHash.current?.());
    const unSection = tools.onSection(() => writeHash.current?.());
    return () => {
      live = false;
      clearTimeout(timer);
      writeHash.current = null;
      unWatch();
      unSection();
    };
  }, [tools]);

  // Onshape's Named views of this robot, shared by the team (the view cube's menu).
  const [named, setNamed] = useState<{ id: string; name: string; view: ViewState; by: string | null; byId: string | null }[]>([]);
  const loadNamed = useCallback(() => {
    fetch(`/api/robots/${robotId}/views`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setNamed(d.views))
      .catch(() => {});
  }, [robotId]);
  useEffect(() => {
    if (tools) loadNamed();
  }, [tools, loadNamed]);
  const goToView = useCallback(
    (v: ViewState) => {
      if (!tools) return;
      const clean = cleanView(v);
      if (!clean) return;
      applyView(tools, clean, true);
      if (changes && (clean.colors === "cad" || clean.colors === "compare")) setColors(clean.colors);
    },
    [tools, changes],
  );
  const views: NamedViews | undefined = tools
    ? {
        list: named.map((v) => ({ id: v.id, name: v.name, by: v.by, mine: me.isAdmin || v.byId === me.id })),
        open: (id) => {
          const v = named.find((x) => x.id === id);
          if (v) goToView(v.view);
        },
        save: async (name) => {
          const r = await saveReviewView(robotId, name, captureView(tools, changes ? colors : undefined));
          if (r.error) return r.error;
          loadNamed();
          return null;
        },
        remove: (id) => void deleteReviewView(id).then((r) => (r.error ? alert(r.error) : loadNamed())),
        copyLink: async () => {
          const url = location.origin + location.pathname + location.search + hashWithView(captureView(tools, changes ? colors : undefined));
          history.replaceState(history.state, "", url);
          return navigator.clipboard.writeText(url).then(
            () => true,
            () => false,
          );
        },
      }
    : undefined;

  // Open and On it, newest first, then To check: a comment whose status moves it out stays where it
  // was, struck through, until the page is left (Harel, 2026-11-13).
  const newest = useMemo(() => [...comments].reverse(), [comments]);
  const open = newest.filter((c) => isActive(c.state));
  const openRows = useStickyList(newest, (c) => isActive(c.state));
  const waitingRows = useStickyList(comments, (c) => c.state === "to_check");
  const waiting = comments.filter((c) => c.state === "to_check");
  const [windowed, setWindowed] = useState<string | null>(null);
  const windowComment = windowed ? comments.find((c) => c.id === windowed) : undefined;
  // Comment pins (S6): numbered in the order the comments were written; open and waiting ones
  // drawn in the 3D view. A tap on a pin or a comment turns the view back to the comment's.
  const pinNo = useMemo(() => new Map(comments.map((c, i) => [c.id, i + 1])), [comments]);
  const viewComment = useCallback(
    (c: ReviewComment) => {
      if (models && c.model !== models.kind) {
        // The other model: its view goes in the address for the new 3D view to put back.
        if (c.view) history.replaceState(history.state, "", location.pathname + location.search + hashWithView(c.view));
        models.onKind(c.model);
        return;
      }
      if (c.view) goToView(c.view);
      tools?.pinHot(c.pin ? c.id : null);
    },
    [goToView, tools, models],
  );
  useEffect(() => {
    if (!tools) return;
    // Pins of the comments written on the model shown (they sit in its coordinates).
    const shown = comments.filter((c) => c.pin && c.state !== "done" && c.model === kind);
    tools.pins(
      shown.map((c) => ({ id: c.id, n: pinNo.get(c.id)!, at: c.pin!, color: statusOf(c.state).color })),
      (id) => {
        const c = comments.find((x) => x.id === id);
        if (c) viewComment(c);
      },
    );
  }, [tools, comments, pinNo, viewComment, kind]);
  const onLocated = useCallback(() => {}, []);
  const showPart = useCallback((key: string) => {
    setSelected(null);
    setDrawer(false);
    setFocus((f) => (f === key ? null : key));
  }, []);
  // The part of the newest pick (the 3D view reports it); a tap on a pick again drops it.
  const onPick = (key: string | null) => {
    if (key) setFocus(null);
    setSelected(key);
  };
  const pickedPart = selected ? partByKey.get(selected) : undefined;
  const picked = selected ? { key: selected, name: pickedPart?.name ?? null, systemId: pickedPart?.systemId ?? null } : null;
  // The 3D view's right-click / long-press menu: Open part, Open system (robot page), Add comment.
  const router = useRouter();
  const pageMenu: PageMenu = (keys) => {
    const one = keys.length === 1 ? partByKey.get(keys[0]) : undefined;
    const systems = new Set(keys.map((k) => partByKey.get(k)?.systemId ?? null));
    const system = onRobot && systems.size === 1 ? [...systems][0] : null;
    return [
      ...(one ? [{ label: "Open part", run: () => void openPartWindow(one.id) }] : []),
      // Onshape's own "Open" on an assembly part opens its Part Studio: a plain link, no API call.
      ...(one?.onshape ? [{ label: "Open in Onshape", run: () => void window.open(one.onshape, "_blank", "noopener") }] : []),
      // The robot's page scoped to that system (?system=), as its Isolate does.
      ...(system ? [{ label: "Open system", run: () => (onIsolate ? onIsolate(system) : router.push(`/robots/${robotId}/cad-review?system=${system}`)) }] : []),
      ...(keys.length === 1 ? [{ label: "Add comment here", run: () => startAdding({ key: keys[0], name: one?.name ?? null, systemId: one?.systemId ?? null }) }] : []),
    ];
  };
  const focusName = focus ? (nameByKey.get(focus) ?? comments.find((c) => c.partKey === focus)?.partName ?? "The part") : null;

  // Esc closes the panel on a phone, then clears the picked or shown part (not under a window).
  useEffect(() => {
    if (!selected && !focus && !drawer && !isolated && !side) return;
    // Esc: closes the phone's panel; else drops the picks and ends Isolate (shows all) (Harel,
    // 2026-11-09).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (drawer) return setDrawer(false);
      // The first Esc folds the comments column away (Harel, 2026-11-11).
      if (side) return setSide(false);
      setSelected(null);
      setFocus(null);
      tools?.measure(null);
      tools?.measure("any");
      if (isolated) {
        tools?.isolate(null);
        setIsolated(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, focus, drawer, tools, isolated, side]);

  return (
    <SnipMe.Provider value={me.id}>
    <CommentContext.Provider value={{ me, canTick, canApprove, open: (c) => setWindowed(c.id) }}>
    <div ref={root} className="relative -m-4 flex h-[calc(100dvh-var(--topbar-h,2.75rem))] md:-m-6">
      {drawer && <button aria-label="Close versions" onClick={() => setDrawer(false)} className="fixed inset-0 z-30 modal-backdrop lg:hidden" />}
      <aside
        className={`flex min-h-0 flex-col gap-4 overflow-y-auto border-line bg-surface p-4 lg:w-[var(--cad-panel-w,20rem)] lg:shrink-0 lg:border-r max-lg:fixed max-lg:top-[var(--review-top,2.75rem)] max-lg:bottom-0 max-lg:left-0 max-lg:z-40 max-lg:w-[min(22rem,88vw)] max-lg:border-r max-lg:shadow-xl ${drawer ? "max-lg:animate-pop" : "max-lg:hidden"}`}
      >
        <div className="max-lg:hidden">
          {back?.href ? (
            <Link href={back.href} className="text-sm text-subtle hover:text-fg">
              ← {back.label}
            </Link>
          ) : back ? (
            <button onClick={back.onClick} className="press text-sm text-subtle hover:text-fg">
              ← {back.label}
            </button>
          ) : null}
          <h1 className="display truncate text-3xl text-accent">{title}</h1>
        </div>
        <button className="btn-primary h-12 w-full justify-center text-base shadow-[0_0_18px_-4px_var(--color-accent)] active:scale-[0.98] max-lg:hidden" onClick={() => startAdding(picked)}>
          + Add comment
        </button>
        {check && (
          <DesignCheck
            key={kind}
            robotId={robotId}
            kind={kind}
            model={model}
            tools={tools}
            names={checkNames}
            systemsOf={systemsOf}
            systems={check.systems}
            onlySystem={onlySystem}
            canCheck={check.canCheck}
            canManage={check.canManage}
            onShow={showFinding}
            onOverlap={showClashOverlap}
            onMark={markCheckFinding}
            picked={selected}
            onComment={commentFinding}
          />
        )}
        {panel(showPart, open)}
      </aside>
      <PanelResizer root={root} />

      <section ref={section} className="relative min-w-0 flex-1 overflow-hidden bg-surface">
        {snipStep === "drag" && <SnipOverlay onSnip={takeSnip} onCancel={() => setSnipStep(null)} />}
        {models?.both && (
          <div className="absolute top-3 left-1/2 z-10 -translate-x-1/2 max-lg:top-16">
            <ModelToggle value={models.kind} onChange={models.onKind} />
          </div>
        )}
        {model ? (
          <ModelCanvas
            model={model}
            colors={compareColors}
            mode={mode}
            locateKey={focus}
            onLocated={onLocated}
            onPick={onPick}
            names={nameByKey}
            onTools={setTools}
            onMeasure={setMeasured}
            onHidden={setHidden}
            hidden={hiddenGroups}
            menu={pageMenu}
            onIsolated={onIsolatedChange}
            views={views}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
            {model === undefined
              ? "Loading the 3D view…"
              : kind === "basepart"
                ? "The Basepart shows here once it's exported (Update 3D view in the Onshape panel, or Update 3D model on the robot page)."
                : "The 3D view shows here once the robot's 3D model is exported (Update 3D model on the robot page)."}
          </div>
        )}

        {/* Phones: the panel behind a Versions button, top left. */}
        <button onClick={() => setDrawer(true)} className="press absolute top-3 left-3 z-10 h-10 rounded-md border border-line bg-surface/95 px-3 text-sm font-semibold text-fg shadow-sm backdrop-blur active:scale-[0.98] lg:hidden">
          ☰ Versions
        </button>
        {/* Phones: the isolated system under it, a tap goes back to the whole robot. */}
        {onlySystem && back?.onClick && (
          <button onClick={back.onClick} className="press absolute top-15 left-3 z-10 flex h-10 max-w-[calc(100%-23rem)] items-center gap-1.5 rounded-md border border-accent/50 bg-surface/95 px-3 text-sm font-semibold text-fg shadow-sm backdrop-blur active:scale-[0.98] lg:hidden max-sm:max-w-[calc(100%-15rem)]" title="Back to the whole robot">
            <span className="truncate">{title}</span>
            <span className="text-subtle">✕</span>
          </button>
        )}

        {/* No pop-up on a pick: the right-click / long-press menu does Isolate, Hide, Open part and
            Open system, like Onshape (Harel, 2026-11-11). This chip stays while a part is shown or
            parts are isolated: the quick way back on a phone. */}
        {(focusName || isolated) && (
          <div className="absolute z-20 flex animate-pop items-center gap-2 rounded-full border border-emerald-500/50 bg-surface/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur max-lg:bottom-20 max-lg:left-1/2 max-lg:-translate-x-1/2 lg:top-3 lg:left-3">
            <span className="font-semibold whitespace-nowrap text-fg">{focusName ? `Showing ${focusName}` : overlapOn ? "Marked in red" : isolated && isolated.length > 1 ? `${isolated.length} parts isolated` : "Isolated"}</span>
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
          onClick={() => startAdding(picked)}
        >
          + Add comment
        </button>

        {/* What's picked: its size, or between two picks distance and angle (bottom right, like
            Onshape's measure box, a bit bigger since 2026-11-11 (Harel); on a phone above + Add
            comment). */}
        <MeasureBox measured={measured} className="max-lg:bottom-20 lg:bottom-3" />

        <ViewerToolbar tools={tools} hidden={hidden}>
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
                <div className="rounded-md border border-line bg-surface/95 px-2.5 py-1.5 text-[0.6875rem] text-fg-2 shadow-sm backdrop-blur">
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
      {/* Open comments, and below them those waiting for approval. Wide screens: a column of
        its own right of the 3D view, so the view (its Fit, its view cube) isn't under it.
        Narrower: over the view's right side, under the view cube (7 rem, 6.5 on touch). */}
      {!side && (
        <button
          onClick={() => setSide(true)}
          title="Show comments"
          className="press absolute top-[8rem] right-3 z-10 flex w-9 flex-col items-center gap-2 rounded-md border border-line bg-surface/95 py-3 text-xs font-semibold text-fg-2 shadow-md hover:bg-raised pointer-coarse:top-[7.5rem] xl:static xl:shrink-0 xl:rounded-none xl:border-y-0 xl:border-r-0 xl:shadow-none"
        >
          <span aria-hidden>‹</span>
          <span className="rounded-full bg-amber-500/15 px-1.5 text-amber-600 tabular-nums">{open.length}</span>
          <span className="[writing-mode:vertical-rl]">Comments</span>
        </button>
      )}
      {side && <PanelResizer root={root} side="right" />}
      <div data-comments className={`absolute top-[8rem] right-3 z-10 flex max-h-[calc(100%-12.5rem)] w-[min(20rem,calc(100%-1.5rem))] flex-col gap-2 pointer-coarse:top-[7.5rem] max-sm:w-48 xl:static xl:max-h-none xl:w-[var(--cad-comments-w,18rem)] xl:shrink-0 xl:overflow-y-auto xl:border-l xl:border-line xl:bg-surface xl:p-3 ${side ? "" : "hidden"}`}>

        <Popup title="Comments" count={open.length} onHide={() => setSide(false)} tone="amber">
          {openRows.length ? (
            onRobot ? (
              <BySystem rows={openRows} onIsolate={onIsolate}>
                {({ c, gone }) => <CommentRow key={c.id} c={c} gone={gone} n={pinNo.get(c.id)} onView={viewComment} onFocus={showPart} />}
              </BySystem>
            ) : (
              openRows.map(({ c, gone }) => <CommentRow key={c.id} c={c} gone={gone} n={pinNo.get(c.id)} onView={viewComment} onFocus={showPart} />)
            )
          ) : (
            <li className="p-2 text-xs text-muted">No open comments.</li>
          )}
        </Popup>
        {canApprove && (
          <Popup title={me.isMentor ? "To check · waiting for you" : "To check"} count={waiting.length} tone="violet">
            {waitingRows.length ? (
              onRobot ? (
                <BySystem rows={waitingRows} onIsolate={onIsolate}>
                  {({ c, gone }) => <CommentRow key={c.id} c={c} gone={gone} n={pinNo.get(c.id)} onView={viewComment} onFocus={showPart} />}
                </BySystem>
              ) : (
                waitingRows.map(({ c, gone }) => <CommentRow key={c.id} c={c} gone={gone} n={pinNo.get(c.id)} onView={viewComment} onFocus={showPart} />)
              )
            ) : (
              <li className="p-2 text-xs text-muted">Nothing to check.</li>
            )}
          </Popup>
        )}
      </div>

      {windowComment && <CommentWindow c={windowComment} onClose={() => setWindowed(null)} onFocus={showPart} onView={viewComment} />}
      {adding !== false && (
        <AddCommentDialog
          // Stays mounted (the text is kept) while the snip is taken and drawn on.
          open={!snipStep}
          onClose={() => !snipStep && closeAdding()}
          robotId={robotId}
          target={target}
          part={adding}
          onClearPart={() => setAdding(null)}
          snip={snipDraft}
          onSnip={() => setSnipStep("drag")}
          onEditSnip={() => setSnipStep("draw")}
          onRemoveSnip={() => setSnipDraft(null)}
          at={addingAt}
          model={kind}
          initialBody={addingBody}
        />
      )}
      {snipStep === "draw" && snipDraft && (
        <SnipEditor
          title="Snip"
          src={snipDraft.dataUrl}
          w={snipDraft.w}
          h={snipDraft.h}
          initial={snipDraft.strokes.map((l) => ({ ...l, by: me.id }))}
          me={me.id}
          isAuthor
          onClose={() => setSnipStep(null)}
          onConfirm={(lines) => {
            setSnipDraft({ ...snipDraft, strokes: lines.map(({ c, s, p }) => ({ c, s, p })) });
            setSnipStep(null);
          }}
        />
      )}
    </div>
    </CommentContext.Provider>
    </SnipMe.Provider>
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

const NO_GROUPS = new Set<number>();

// The robot's comments in a section per system, the whole robot's first, like CAD's old board
// (Harel, 2026-11-10): a tap on a name folds its section, Isolate scopes the page to the system.
type Row = { c: ReviewComment; gone: boolean };

function BySystem({ rows, onIsolate, children }: { rows: Row[]; onIsolate?: (systemId: string) => void; children: (r: Row) => React.ReactNode }) {
  const groups = new Map<string, { id: string | null; name: string; list: Row[] }>();
  for (const r of rows) {
    const c = r.c;
    const k = c.systemId ?? "";
    const g = groups.get(k) ?? { id: c.systemId, name: c.systemId ? (c.systemName ?? "System") : "Whole robot", list: [] };
    g.list.push(r);
    groups.set(k, g);
  }
  const list = [...groups.values()].sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : a.name.localeCompare(b.name)));
  return list.map((g) => (
    <SystemSection key={g.id ?? "robot"} name={g.name} count={g.list.filter((r) => !r.gone).length} onIsolate={g.id && onIsolate ? () => onIsolate(g.id!) : undefined}>
      {g.list.map(children)}
    </SystemSection>
  ));
}

function SystemSection({ name, count, onIsolate, children }: { name: string; count: number; onIsolate?: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <li className="mb-1 rounded-md border border-line last:mb-0">
      <div className={`flex items-center ${open ? "border-b border-line" : ""}`}>
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="press flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-xs font-semibold text-fg hover:bg-raised pointer-coarse:min-h-10">
          <span className={`text-subtle transition-transform ${open ? "" : "-rotate-90"}`}>▾</span>
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span className="rounded-full bg-raised px-1.5 text-fg-2 tabular-nums">{count}</span>
        </button>
        {onIsolate && (
          <button onClick={onIsolate} className="press px-2.5 py-1.5 text-[0.6875rem] font-semibold text-accent-hover hover:underline pointer-coarse:min-h-10" title={`Show only ${name}`}>
            Isolate
          </button>
        )}
      </div>
      {open && <ul>{children}</ul>}
    </li>
  );
}


function Popup({ title, count, onHide, tone, children }: { title: string; count: number; onHide?: () => void; tone: "amber" | "violet"; children: React.ReactNode }) {
  const badge = tone === "amber" ? "bg-amber-500/15 text-amber-600" : "bg-violet-500/15 text-violet-600 dark:text-violet-300";
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface/95 shadow-md backdrop-blur">
      {/* No folding up and down: the column folds sideways from the arrow (Harel, 2026-11-11). */}
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-fg pointer-coarse:min-h-11">
        <span className="flex-1 truncate">{title}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${badge}`}>{count}</span>
        {onHide && (
          <button onClick={onHide} title="Hide comments" className="press -mr-1 rounded px-1.5 text-subtle hover:bg-raised hover:text-fg pointer-coarse:min-h-9 pointer-coarse:min-w-9">
            ›
          </button>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto border-t border-line p-1">{children}</ul>
    </div>
  );
}

// The panel's width on wide screens, dragged from its right edge like the shell's side columns
// (Harel, 2026-11-09): written straight onto the screen while dragging, kept in this browser.
// Double-click goes back to the normal width. Narrowest: 100 px (Harel, 2026-11-09).
// `side`: "left" the panel (handle on its right edge), "right" the comments column (handle on its
// left edge, dragging left widens it) (Harel, 2026-11-11).
function PanelResizer({ root, side = "left" }: { root: React.RefObject<HTMLDivElement | null>; side?: "left" | "right" }) {
  const PANEL_KEY = side === "left" ? "orbit-cad-panel-w" : "orbit-cad-comments-w";
  const PANEL_DEFAULT = side === "left" ? 320 : 288;
  const target = side === "left" ? "aside" : "[data-comments]";
  const set = (w: number) => root.current?.style.setProperty(side === "left" ? "--cad-panel-w" : "--cad-comments-w", `${w}px`);
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem(PANEL_KEY));
      if (w) set(w);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on load
  }, []);
  const save = (w: number) => {
    set(w);
    try {
      localStorage.setItem(PANEL_KEY, String(w));
    } catch {}
  };
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    const aside = root.current?.querySelector<HTMLElement>(target);
    if (!aside || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const w0 = aside.getBoundingClientRect().width;
    const x0 = e.clientX;
    const max = Math.max(PANEL_DEFAULT, window.innerWidth / 2);
    let w = w0;
    let frame = 0;
    const move = (ev: PointerEvent) => {
      w = Math.round(Math.min(max, Math.max(100, w0 + (side === "left" ? 1 : -1) * (ev.clientX - x0))));
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => set(w));
    };
    const end = () => {
      cancelAnimationFrame(frame);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.classList.remove("select-none", "cursor-col-resize");
      save(w);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    document.body.classList.add("select-none", "cursor-col-resize");
  };
  return (
    <div className={`relative z-10 hidden w-0 ${side === "left" ? "lg:block" : "xl:block"}`}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize the panel"
        title="Drag to resize, double-click to reset"
        onPointerDown={start}
        onDoubleClick={() => save(PANEL_DEFAULT)}
        className="group absolute inset-y-0 -left-1.5 w-3 cursor-col-resize touch-none"
      >
        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-accent opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-active:opacity-100" />
      </div>
    </div>
  );
}
