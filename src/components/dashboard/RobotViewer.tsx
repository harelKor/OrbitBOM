"use client";

import { CALL_COSTS, costHint } from "@/config/callCosts";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StatusCount } from "@/lib/stats";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { buildModel } from "@/components/viewer/buildModel";
import { drawPictures } from "@/components/viewer/pictures";
import { MeasureBox } from "@/components/viewer/MeasureBox";
import { openInOnshape } from "@/lib/onshape/partLink";
import type { PageMenu, ViewerMode, ViewerModel } from "./ModelCanvas";
import { useMeasurePicks } from "./useMeasurePicks";
import {
  BULK_ASK_EVENT,
  BULK_SELECTION_EVENT,
  BULK_TOGGLE_EVENT,
  MODEL_STALE_EVENT,
  OPEN_PART_EVENT,
  OPEN_PART_PENDING,
  type BulkSelectionDetail,
  type BulkToggleDetail,
  type ModelStaleDetail,
  type OpenPartDetail,
} from "./modelEvents";

const ModelCanvas = dynamic(() => import("./ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });

// A BOM part as the viewer knows it: its key in the model, status colour, and where its card is.
// `onshape`: the part in Onshape at its system's BOM version (the 3D menu's Open in Onshape).
export type ViewerPart = { key: string; color: string; id: string; systemId: string; name: string; fab: boolean; onshape?: string };

// The 3D robot stage. The model is built from the systems' Onshape assemblies on demand
// (Edit mode's Update 3D model) and kept in R2; viewing it costs no Onshape calls. On the page it
// sits in a thin outline on the page's own background that glows on hover, and a click beside the
// model (not on a part, which picks it, nor a drag, which turns it) opens it large over the page, leaving the side panels and a
// margin of background (Harel, 2026-11-07). No Subsystems panel (Harel, 2026-11-18). On a system page
// (systemId) it shows only that subsystem. A click on a part highlights it; a second click on it
// opens its details window over the viewer, which stays as it is behind it (from a page without the
// part's card, it goes to the system page and opens it there). (Locate opens a part's own window
// from its card: PartStage.)
export function RobotViewer({
  robotId,
  systemId,
  statuses,
  parts,
  builtAt,
  hasAssembly,
  edit,
}: {
  robotId: string;
  systemId?: string;
  statuses: StatusCount[];
  parts: ViewerPart[]; // BOM parts by Onshape identity
  builtAt: string | null;
  hasAssembly: boolean;
  edit: boolean;
}) {
  // The BOM pages show the Final model only: the Basepart is the CAD page's (Harel, 2026-11-13).
  // CAD: parts look as Onshape draws them, with a light wash of their BOM status colour (Harel,
  // 2026-11-13). Status: every part see-through in its status colour, the slider setting how much;
  // parts with a status a little clearer than the rest (Harel, 2026-11-17). Both kept per device.
  const [view, setView] = useStored<"cad" | "status">(VIEW_KEY, "cad", (v) => (v === "status" ? "status" : v === "cad" ? "cad" : null));
  const [opacity, setOpacity] = useStored(OPACITY_KEY, 0.5, (v) => {
    const n = Number(v);
    return v !== null && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
  });
  const colors: ViewerMode = view === "status" ? "status" : "tint";
  const router = useRouter();
  const [large, setLarge] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [version, setVersion] = useState(builtAt);
  // undefined while loading, null when there is no model to show.
  const [model, setModel] = useState<ViewerModel | null | undefined>(version ? undefined : null);
  // The model file couldn't be fetched: Retry, not "press Update 3D model" (that spends Onshape
  // calls on a model that exists).
  const [fetchFailed, setFetchFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [building, setBuilding] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const colorMap = useMemo(() => new Map(parts.map((p) => [p.key, p.color])), [parts]);
  const legend = statuses.filter((s) => s.count > 0);
  const onLocated = useCallback(() => {}, []);
  const partByKey = useMemo(() => new Map(parts.map((p) => [p.key, p])), [parts]);
  const nameByKey = useMemo(() => new Map(parts.map((p) => [p.key, p.name])), [parts]);
  // The page's Bulk edit selection (part ids), while it's on: drawn in green, and a click on a
  // part adds it or takes it out instead of picking it (Harel, 2026-11-10).
  const [bulk, setBulk] = useState<string[] | null>(null);
  useEffect(() => {
    const onBulk = (e: Event) => {
      const { ids } = (e as CustomEvent<BulkSelectionDetail>).detail;
      setBulk(ids);
      if (ids) setSelected(null);
    };
    window.addEventListener(BULK_SELECTION_EVENT, onBulk);
    window.dispatchEvent(new Event(BULK_ASK_EVENT)); // Bulk edit may be on already
    return () => window.removeEventListener(BULK_SELECTION_EVENT, onBulk);
  }, []);
  const bulkKeys = useMemo(() => {
    if (!bulk) return null;
    const keyOf = new Map(parts.map((p) => [p.id, p.key]));
    return bulk.flatMap((id) => keyOf.get(id) ?? []);
  }, [bulk, parts]);
  // Points, edges and faces pick and measure as on the CAD page; Bulk edit takes whole parts.
  const picks = useMeasurePicks(!bulk);
  const lastTap = useRef(0); // a left click on the canvas, to tell it from a pick cleared by code
  const openLarge = () => setLarge(true);
  // A click picks a point, edge or face (its part is `selected`: the newest pick's); Open part and
  // Open system are in the right-click / long-press menu, as on CAD (Harel, 2026-11-17). With
  // nothing picked, a click beside the small model opens it large (Harel, 2026-11-07).
  const onPick = (key: string | null) => {
    if (bulk) {
      const part = key ? partByKey.get(key) : undefined;
      if (part) window.dispatchEvent(new CustomEvent<BulkToggleDetail>(BULK_TOGGLE_EVENT, { detail: { partId: part.id } }));
      // Only a real click: turning Bulk edit on drops the measure picks, which reports an empty
      // pick, and that opened the view large by itself (Harel, 2026-11-21).
      else if (!key && !large && performance.now() - lastTap.current < 500) openLarge();
      return;
    }
    if (!key && !selected && !large && performance.now() - lastTap.current < 500) openLarge();
    setSelected(key);
  };
  // Box select in the 3D view while Bulk edit is on adds the boxed parts' rows (Harel, 2026-11-17).
  const onBox = (keys: string[], drop: boolean) => {
    for (const key of keys) {
      const part = partByKey.get(key);
      if (part) window.dispatchEvent(new CustomEvent<BulkToggleDetail>(BULK_TOGGLE_EVENT, { detail: { partId: part.id, set: !drop } }));
    }
  };
  const pageMenu: PageMenu = (keys) => {
    const found = [...new Set(keys)].flatMap((k) => partByKey.get(k) ?? []);
    const one = found.length === 1 ? found[0] : undefined;
    const systems = new Set(found.map((p) => p.systemId));
    const system = systems.size === 1 ? [...systems][0] : null;
    return [
      ...(one ? [{ label: "Open part", run: () => onOpen(one.key) }] : []),
      // The BOM's version in Onshape, not the workspace (Harel, 2026-11-19).
      ...(one?.onshape ? [openInOnshape(one.onshape)] : []),
      // Not on the system's own page: it's already there.
      ...(system && system !== systemId
        ? [
            {
              label: "Open system",
              run: () => {
                setLarge(false);
                router.push(`/robots/${robotId}/systems/${system}`);
              },
            },
          ]
        : []),
    ];
  };
  const onOpen = (key: string) => {
    const part = partByKey.get(key);
    if (!part) return; // placed in CAD but not on the BOM
    const detail: OpenPartDetail = { partId: part.id, taken: false };
    window.dispatchEvent(new CustomEvent(OPEN_PART_EVENT, { detail }));
    if (detail.taken) return;
    try {
      sessionStorage.setItem(OPEN_PART_PENDING, part.id);
    } catch {}
    setLarge(false);
    router.push(`/robots/${robotId}/systems/${part.systemId}#part-${part.id}`);
  };
  const groups = useMemo(() => model?.groups ?? [], [model]);
  // A system page draws only the groups its system is in.
  const ownGroups = useMemo(
    () => (systemId ? groups.flatMap((g, i) => (g.systemIds.includes(systemId) ? [i] : [])) : null),
    [groups, systemId],
  );
  const hidden = useMemo(
    () => (ownGroups ? new Set(groups.map((_, i) => i).filter((i) => !ownGroups.includes(i))) : new Set<number>()),
    [ownGroups, groups],
  );

  // Esc first drops the picks, then closes the large view (Harel, 2026-11-07). Not while a
  // window is open over it: that Esc is the window's.
  const { picked, clear: clearPicks } = picks;
  useEffect(() => {
    if (!large && !picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      e.preventDefault(); // used here, so the shell doesn't also collapse a side column
      if (picked) clearPicks();
      else setLarge(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [large, picked, clearPicks]);

  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    // The BOM model: each system as its BOM version has it (Harel, 2026-11-18).
    fetch(`/api/robots/${robotId}/model?model=bom${systemId ? `&system=${systemId}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { model: ViewerModel | null }) => {
        if (cancelled) return;
        setModel(d?.model ?? null);
        setFetchFailed(false);
      })
      .catch(() => !cancelled && setFetchFailed(true));
    return () => {
      cancelled = true;
    };
  }, [robotId, systemId, version, attempt]);

  const buildRef = useRef(build);
  useEffect(() => {
    buildRef.current = build;
  });
  useEffect(() => {
    const onStale = (e: Event) => {
      const detail = (e as CustomEvent<ModelStaleDetail | undefined>).detail;
      if (detail) detail.taken = true;
      void buildRef.current().finally(() => detail?.resolve());
    };
    window.addEventListener(MODEL_STALE_EVENT, onStale);
    return () => window.removeEventListener(MODEL_STALE_EVENT, onStale);
  }, []);

  async function build() {
    setMessage(null);
    setBuilding("Checking Onshape…");
    try {
      const r = await buildModel(robotId, setBuilding);
      if (!r.ok) return setMessage({ text: r.error, error: true });
      const calls = r.calls;
      setMessage({
        text: r.unchanged
          ? `The 3D model is up to date (${calls} Onshape call${calls === 1 ? "" : "s"}).`
          : `3D model updated: ${r.parts} parts (${calls} Onshape calls).`,
      });
      if (!r.unchanged) setVersion(new Date().toISOString());
      // The pictures the new model changed, drawn from it (no Onshape calls).
      setBuilding("Drawing the pictures…");
      if (await drawPictures(robotId, systemId)) router.refresh();
    } finally {
      setBuilding(null);
    }
  }

  // Pictures still missing (a model built on the server, like a first sync from the Onshape
  // panel), drawn once per page by a CAD member's browser, quietly.
  const pictured = useRef(false);
  useEffect(() => {
    if (!edit || !model || pictured.current) return;
    pictured.current = true;
    void drawPictures(robotId, systemId).then((n) => n && router.refresh());
  }, [edit, model, robotId, systemId, router]);

  return (
    <>
      {large && (
        <button
          aria-label="Back to the dashboard"
          onClick={() => setLarge(false)}
          className="fixed inset-y-0 right-[var(--shell-right)] left-[var(--shell-left)] z-[29] cursor-default modal-backdrop"
        />
      )}
      <section
        id="viewer"
        tabIndex={large ? undefined : 0}
        aria-label={large ? undefined : "3D view: open large"}
        title={large ? undefined : "Open large"}
        onPointerUpCapture={(e) => {
          if (e.button === 0 && (e.target as HTMLElement).tagName === "CANVAS") lastTap.current = performance.now();
        }}
        onClick={(e) => {
          // The canvas reports its own clicks (onPick) so a drag can turn the model; the controls
          // keep theirs.
          const target = e.target as HTMLElement;
          if (large || target.tagName === "CANVAS" || target.closest("button, a, input, label, [role=radiogroup], [role=status]")) return;
          if (picked) clearPicks();
          else openLarge();
        }}
        onKeyDown={(e) => {
          if (!large && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openLarge();
          }
        }}
        className={
          large
            ? "fixed inset-y-6 right-[calc(var(--shell-right)+1.5rem)] left-[calc(var(--shell-left)+1.5rem)] z-30 modal flex flex-col overflow-hidden"
            : "stage-frame stage-glow flex min-h-80 flex-1 cursor-pointer flex-col overflow-hidden"
        }
      >
        <div className={`flex cursor-auto flex-wrap items-center gap-3 px-4 py-3 ${large ? "border-b border-line" : ""}`}>
          <Icon name="cube" className="h-4 w-4 text-accent-hover" />
          <h2 className="text-sm font-semibold">{systemId ? "3D View" : "3D Assembly Status View"}</h2>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {edit && hasAssembly && (
              <button className="btn h-8 text-xs" onClick={build} disabled={!!building} {...costHint(CALL_COSTS.update3d)}>
                {building ?? "Update 3D model"}
              </button>
            )}
            {model && (
              <Segmented
                label="Part colours"
                value={view}
                onChange={setView}
                options={[
                  { value: "cad", label: "CAD" },
                  { value: "status", label: "Status" },
                ]}
              />
            )}
            {model && view === "status" && (
              <label className="flex items-center gap-2 text-xs font-semibold text-muted pointer-coarse:min-h-9" title="How see-through the parts are">
                Opacity
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(opacity * 100)}
                  onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                  className="h-1 w-24 cursor-pointer accent-accent pointer-coarse:h-6 sm:w-32"
                  aria-label="Part opacity"
                />
                <span className="w-8 text-right tabular-nums">{Math.round(opacity * 100)}%</span>
              </label>
            )}
            {large && (
              <button
                onClick={() => setLarge(false)}
                className="btn h-8 w-8 justify-center px-0"
                aria-label="Back to the dashboard"
                title="Back to the dashboard (Esc)"
              >
                <Icon name="shrink" />
              </button>
            )}
          </div>
        </div>
        <div className="relative min-h-72 flex-1 overflow-hidden">
          {model ? (
            <ModelCanvas
              model={model}
              colors={colorMap}
              mode={colors}
              locateKey={null}
              onLocated={onLocated}
              hidden={hidden}
              selectedKey={bulkKeys}
              onPick={onPick}
              onBox={bulk ? onBox : undefined}
              onTools={picks.setTools}
              onMeasure={picks.setMeasured}
              menu={pageMenu}
              names={nameByKey}
              cube // the view cube and its menu, as on CAD's pages (Harel, 2026-11-11)
              statusOpacity={view === "status" ? opacity : null}
            />
          ) : (
            <>
              {/* Grid floor in perspective. */}
              <div
                aria-hidden
                className="absolute inset-x-[-50%] bottom-[-10%] h-[70%] [transform:perspective(500px)_rotateX(62deg)] opacity-60"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(0,0,204,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,204,0.14) 1px, transparent 1px)",
                  backgroundSize: "36px 36px",
                  maskImage: "linear-gradient(to top, black 30%, transparent)",
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                <p className="max-w-72 text-sm text-muted">
                  {fetchFailed ? (
                    <span className="flex flex-col items-center gap-2">
                      The 3D model couldn&apos;t load.
                      <button
                        type="button"
                        className="btn min-h-9 active:scale-[0.98]"
                        onClick={() => {
                          setFetchFailed(false);
                          setAttempt((n) => n + 1);
                        }}
                      >
                        Retry
                      </button>
                    </span>
                  ) : model === undefined
                    ? "Loading the robot…"
                    : !hasAssembly
                      ? edit
                        ? "Link this robot's systems to their Onshape assemblies (from the Onshape panel or a system's gear), then press Update 3D model."
                        : "The robot model shows here once its systems are linked to Onshape."
                      : edit
                        ? "Press Update 3D model to export the robot from Onshape."
                        : "The robot model shows here once it's exported from Onshape by the CAD Team."}
                </p>
              </div>
            </>
          )}
          {bulk ? (
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 animate-pop rounded-md border border-accent/40 bg-surface/95 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-fg-2 shadow-sm backdrop-blur">
              Bulk edit: tap parts to select them
            </div>
          ) : null}
          {/* Over the colour legend, which stays readable beside it on a wide view. */}
          <div onClick={(e) => e.stopPropagation()} className="cursor-auto">
            <MeasureBox measured={picks.measured} className="bottom-9" />
          </div>
          {model && systemId && !ownGroups?.length && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="max-w-72 rounded-md bg-surface/90 p-3 text-sm text-muted">
                {edit
                  ? "This subsystem isn't in the robot's 3D model yet. Press Update 3D model."
                  : "This subsystem shows here once the robot's 3D model is updated by the CAD Team."}
              </p>
            </div>
          )}
          {message && (
            <div
              role="status"
              // Under the view cube when the model shows.
              className={`absolute ${model ? "top-33" : "top-3"} right-3 max-w-72 animate-pop rounded-md border bg-surface/95 px-3 py-2 text-xs shadow-sm backdrop-blur ${
                message.error ? "border-rose-400/60 text-rose-500" : "border-line text-fg-2"
              }`}
            >
              {message.text}
            </div>
          )}
          {legend.length > 0 && (
            <div
              className={`pointer-events-none absolute right-3 bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-fg-2`}
            >
              {legend.map((s) => (
                <span key={s.name} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

const VIEW_KEY = "orbit-bom-3d-view";
const OPACITY_KEY = "orbit-bom-3d-opacity";

// A setting remembered in this browser: the default until it's read after the first render (the
// server can't see it), then the stored one.
function useStored<T>(key: string, initial: T, parse: (v: string | null) => T | null) {
  const [value, set] = useState(initial);
  const parseRef = useRef(parse);
  useEffect(() => {
    try {
      const v = parseRef.current(localStorage.getItem(key));
      if (v !== null) set(v);
    } catch {}
  }, [key]);
  const save = useCallback(
    (v: T) => {
      set(v);
      try {
        localStorage.setItem(key, String(v));
      } catch {}
    },
    [key],
  );
  return [value, save] as const;
}
