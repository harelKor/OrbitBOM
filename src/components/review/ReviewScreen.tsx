"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openPartWindow } from "@/components/bom/PartDetailsHost";
import type { HiddenParts, MeasureInfo, PageMenu, SceneTools, ViewerModel, ViewerMode } from "@/components/dashboard/ModelCanvas";
import { AddCommentDialog, OpenComment, WaitingComment, type CommentTarget } from "@/components/review/Comments";
import { SnipEditor, SnipMe, SnipOverlay, type SnipDraft } from "@/components/review/Snip";
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
  onlySystem = null,
  onIsolate,
  panel,
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
}) {
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
  const [hidden, setHidden] = useState<HiddenParts | null>(null);
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

  // Points, edges and faces are picked at all times, like Onshape (Harel, 2026-11-09).
  useEffect(() => {
    tools?.measure("any");
  }, [tools]);
  const clearPicks = () => {
    tools?.measure(null);
    tools?.measure("any");
  };

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

  const open = comments.filter((c) => c.state === "open").reverse();
  const waiting = comments.filter((c) => c.state === "done");
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
  // On the robot's page: the one system all picked parts are in (Open system), else none.
  const pickedSystems = new Set(measured.parts.map((k) => partByKey.get(k)?.systemId ?? null));
  const oneSystem = onRobot && pickedSystems.size === 1 ? [...pickedSystems][0] : null;
  // Every pick on one BOM part: Open part opens its BOM window.
  const onePart = measured.parts.length === 1 ? partByKey.get(measured.parts[0]) : undefined;
  const picked = selected ? { key: selected, name: pickedPart?.name ?? null, systemId: pickedPart?.systemId ?? null } : null;
  // The 3D view's right-click / long-press menu: Open part, Open system (robot page), Add comment.
  const router = useRouter();
  const pageMenu: PageMenu = (keys) => {
    const one = keys.length === 1 ? partByKey.get(keys[0]) : undefined;
    const systems = new Set(keys.map((k) => partByKey.get(k)?.systemId ?? null));
    const system = onRobot && systems.size === 1 ? [...systems][0] : null;
    return [
      ...(one ? [{ label: "Open part", run: () => void openPartWindow(one.id) }] : []),
      // The robot's page scoped to that system (?system=), as its Isolate does.
      ...(system ? [{ label: "Open system", run: () => (onIsolate ? onIsolate(system) : router.push(`/robots/${robotId}/cad-review?system=${system}`)) }] : []),
      ...(keys.length === 1 ? [{ label: "Add comment here", run: () => setAdding({ key: keys[0], name: one?.name ?? null, systemId: one?.systemId ?? null }) }] : []),
    ];
  };
  const focusName = focus ? (nameByKey.get(focus) ?? comments.find((c) => c.partKey === focus)?.partName ?? "The part") : null;

  // Esc closes the panel on a phone, then clears the picked or shown part (not under a window).
  useEffect(() => {
    if (!selected && !focus && !drawer && !isolated) return;
    // Esc: closes the phone's panel; else drops the picks and ends Isolate (shows all) (Harel,
    // 2026-11-09).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (drawer) return setDrawer(false);
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
  }, [selected, focus, drawer, tools, isolated]);

  return (
    <SnipMe.Provider value={me.id}>
    <div ref={root} className="-m-4 flex h-[calc(100dvh-var(--topbar-h,2.75rem))] md:-m-6">
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
        <button className="btn-primary h-12 w-full justify-center text-base shadow-[0_0_18px_-4px_var(--color-accent)] active:scale-[0.98] max-lg:hidden" onClick={() => setAdding(picked)}>
          + Add comment
        </button>
        {panel(showPart, open)}
      </aside>
      <PanelResizer root={root} />

      <section ref={section} className="relative min-w-0 flex-1 overflow-hidden bg-surface">
        {snipStep === "drag" && <SnipOverlay onSnip={takeSnip} onCancel={() => setSnipStep(null)} />}
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
            onIsolated={setIsolated}
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
        {/* Phones: the isolated system under it, a tap goes back to the whole robot. */}
        {onlySystem && back?.onClick && (
          <button onClick={back.onClick} className="press absolute top-15 left-3 z-10 flex h-10 max-w-[calc(100%-23rem)] items-center gap-1.5 rounded-md border border-accent/50 bg-surface/95 px-3 text-sm font-semibold text-fg shadow-sm backdrop-blur active:scale-[0.98] lg:hidden max-sm:max-w-[calc(100%-15rem)]" title="Back to the whole robot">
            <span className="truncate">{title}</span>
            <span className="text-subtle">✕</span>
          </button>
        )}

        {/* Top right: open comments, and below them those waiting for approval. */}
        <div className="absolute top-3 right-3 z-10 flex max-h-[calc(100%-5rem)] w-[min(20rem,calc(100%-1.5rem))] flex-col gap-2 max-sm:w-48">
          <Popup title="Open comments" count={open.length} shown={openList} onToggle={() => setOpenList(flip(openList))} tone="amber">
            {open.length ? (
              onRobot ? (
                <BySystem comments={open} onIsolate={onIsolate}>
                  {(c) => <OpenComment key={c.id} c={c} canTick={canTick} canDelete={me.isAdmin || c.authorId === me.id} onFocus={showPart} />}
                </BySystem>
              ) : (
                open.map((c) => <OpenComment key={c.id} c={c} canTick={canTick} canDelete={me.isAdmin || c.authorId === me.id} onFocus={showPart} />)
              )
            ) : (
              <li className="p-2 text-xs text-muted">No open comments.</li>
            )}
          </Popup>
          {canApprove && (
            <Popup title={me.isMentor ? "Waiting for you" : "Waiting for approval"} count={waiting.length} shown={waitList} onToggle={() => setWaitList(flip(waitList))} tone="sky">
              {waiting.length ? (
                onRobot ? (
                  <BySystem comments={waiting} onIsolate={onIsolate}>
                    {(c) => <WaitingComment key={c.id} c={c} isMentor canTick={canTick} onFocus={showPart} />}
                  </BySystem>
                ) : (
                  waiting.map((c) => <WaitingComment key={c.id} c={c} isMentor canTick={canTick} onFocus={showPart} />)
                )
              ) : (
                <li className="p-2 text-xs text-muted">Nothing ticked off to approve.</li>
              )}
            </Popup>
          )}
        </div>

        {/* The picked parts, stacked (a pick on another part adds it): Isolate shows only them,
            Hide hides them; Open part when they're all on one part, and on the robot's page Open
            system when they're all in one system (Harel, 2026-11-09). The page's + Add comment ties a comment to the
            newest one. */}
        {measured.parts.length > 0 && (
          <div className="absolute z-20 flex w-60 max-w-[calc(100%-1.5rem)] animate-pop flex-col gap-2 rounded-md border border-accent/50 bg-surface/95 p-2.5 text-xs shadow-sm backdrop-blur max-lg:bottom-20 max-lg:left-1/2 max-lg:-translate-x-1/2 lg:top-3 lg:left-3">
            <ul className="max-h-36 space-y-0.5 overflow-y-auto">
              {measured.parts.map((k) => (
                <li key={k} className="truncate font-semibold text-fg">
                  {nameByKey.get(k) ?? "Placed in CAD, not on the BOM"}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                className="btn h-8 flex-1 justify-center px-2.5 text-xs pointer-coarse:h-9"
                onClick={() => {
                  const next = isolated ? null : measured.parts;
                  tools?.isolate(next);
                  setIsolated(next);
                }}
              >
                {isolated ? "Show all" : "Isolate"}
              </button>
              <button
                className="btn h-8 flex-1 justify-center px-2.5 text-xs pointer-coarse:h-9"
                onClick={() => {
                  for (const k of measured.parts) tools?.hideKey(k);
                  clearPicks();
                }}
              >
                Hide
              </button>
            </div>
            {onePart && (
              <button className="btn h-8 justify-center px-2.5 text-xs pointer-coarse:h-9" onClick={() => void openPartWindow(onePart.id)}>
                Open part
              </button>
            )}
            {oneSystem && (
              <Link href={`/robots/${robotId}/systems/${oneSystem}/cad-review`} className="btn h-8 justify-center px-2.5 text-xs pointer-coarse:h-9">
                Open system
              </Link>
            )}
          </div>
        )}
        {measured.parts.length === 0 && (focusName || isolated) && (
          <div className="absolute z-20 flex animate-pop items-center gap-2 rounded-full border border-emerald-500/50 bg-surface/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur max-lg:bottom-20 max-lg:left-1/2 max-lg:-translate-x-1/2 lg:top-3 lg:left-3">
            <span className="font-semibold whitespace-nowrap text-fg">{focusName ? `Showing ${focusName}` : isolated && isolated.length > 1 ? `${isolated.length} parts isolated` : "Isolated"}</span>
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

        {/* What's picked: its size, or between two picks distance and angle (bottom right; on a
            phone above the part popup and + Add comment). */}
        {measured.picks.length > 0 && (
          <div className="absolute right-3 z-20 w-64 max-w-[calc(100%-1.5rem)] animate-pop rounded-md border border-line bg-surface/95 p-2.5 text-xs shadow-md backdrop-blur max-lg:bottom-40 lg:bottom-3">
            <ul className="max-h-32 space-y-0.5 overflow-y-auto">
              {measured.picks.map((p, k) => (
                <li key={k} className="flex items-center gap-1.5 text-fg-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[#ff8a1f]" />
                  <span className="truncate">{p}</span>
                </li>
              ))}
            </ul>
            <table className="mt-1.5 w-full tabular-nums">
              <tbody>
                {measured.rows.map((r) => (
                  <tr key={r.label} className="border-t border-line">
                    <td className="py-1 pr-2 text-muted">{r.label}</td>
                    <td className="py-1 text-right text-base font-bold text-fg">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {measured.picks.length === 1 && <p className="mt-1 text-[11px] text-subtle">Pick a second one to measure between them.</p>}
            {measured.picks.length > 2 && <p className="mt-1 text-[11px] text-subtle">Measures show for one or two picks. Space drops the newest, Esc all.</p>}
          </div>
        )}

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
function BySystem({ comments, onIsolate, children }: { comments: ReviewComment[]; onIsolate?: (systemId: string) => void; children: (c: ReviewComment) => React.ReactNode }) {
  const groups = new Map<string, { id: string | null; name: string; list: ReviewComment[] }>();
  for (const c of comments) {
    const k = c.systemId ?? "";
    const g = groups.get(k) ?? { id: c.systemId, name: c.systemId ? (c.systemName ?? "System") : "Whole robot", list: [] };
    g.list.push(c);
    groups.set(k, g);
  }
  const list = [...groups.values()].sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : a.name.localeCompare(b.name)));
  return list.map((g) => (
    <SystemSection key={g.id ?? "robot"} name={g.name} count={g.list.length} onIsolate={g.id && onIsolate ? () => onIsolate(g.id!) : undefined}>
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
          <button onClick={onIsolate} className="press px-2.5 py-1.5 text-[11px] font-semibold text-accent-hover hover:underline pointer-coarse:min-h-10" title={`Show only ${name}`}>
            Isolate
          </button>
        )}
      </div>
      {open && <ul>{children}</ul>}
    </li>
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

// The panel's width on wide screens, dragged from its right edge like the shell's side columns
// (Harel, 2026-11-09): written straight onto the screen while dragging, kept in this browser.
// Double-click goes back to the normal width. Narrowest: 100 px (Harel, 2026-11-09).
const PANEL_KEY = "orbit-cad-panel-w";
const PANEL_DEFAULT = 320;
function PanelResizer({ root }: { root: React.RefObject<HTMLDivElement | null> }) {
  const set = (w: number) => root.current?.style.setProperty("--cad-panel-w", `${w}px`);
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
    const aside = root.current?.querySelector("aside");
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
      w = Math.round(Math.min(max, Math.max(100, w0 + ev.clientX - x0)));
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
    <div className="relative z-10 hidden w-0 lg:block">
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
