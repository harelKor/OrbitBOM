"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { ModelPart } from "@/lib/data/parts";
import { MeasureBox } from "@/components/viewer/MeasureBox";
import { costHint, openFlatCost } from "@/config/callCosts";
import { openInOnshape } from "@/lib/onshape/partLink";
import type { PageMenu, ViewerModel } from "./ModelCanvas";
import { useMeasurePicks } from "./useMeasurePicks";

const ModelCanvas = dynamic(() => import("./ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });
const NO_COLORS = new Map<string, string>();

// "flat": a sheet metal part's flat pattern from Onshape (Open flatten, Harel 2026-11-17).
export type StageView = "part" | "locate" | "flat";

// A part's 3D window in the middle of the screen, opened from its card without leaving the
// page: the part on its own ("part"), or where it sits in the see-through robot ("locate").
// The corner button switches between the two. The part shows in its Onshape appearance.
export function PartStage({
  partId,
  robotId,
  modelKey,
  name,
  view,
  onView,
  flat,
  sources,
  onClose,
}: ModelProps & { name: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="m-auto h-[min(max(50vh,26rem),calc(100vh-2rem))] w-[min(max(50vw,36rem),calc(100vw-2rem))] modal max-w-none overflow-hidden p-0"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <Icon name={view === "locate" ? "locate" : view === "flat" ? "layers" : "cube"} className="h-4 w-4 text-accent-hover" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h2>
          <button onClick={() => dialog.current?.close()} className="press rounded p-1 text-muted hover:text-fg" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <PartModel partId={partId} robotId={robotId} modelKey={modelKey} view={view} onView={onView} flat={flat} sources={sources} className="flex-1" />
      </div>
    </dialog>
  );
}

type ModelProps = {
  partId: string;
  robotId: string | null;
  modelKey: string | null;
  view: StageView;
  onView: (view: StageView) => void;
  // Shows Open flatten: a part bent on a Bending machine (its flat pattern, if it's sheet metal).
  flat?: boolean;
  // The /dev/viewer sandbox's stand-in files, by view (no database or Onshape there).
  sources?: Partial<Record<StageView, string>>;
};

// The live 3D stage itself, in a window (PartStage) or inline (the part details window, which
// draws its own Locate button: `locateButton={false}`). Points, edges and faces pick and measure as
// on the CAD page, and in the robot (Locate) the right-click / long-press menu has Open part (its
// window on top) and Open system (Harel, 2026-11-17). Esc drops the picks before it closes the window.
export function PartModel({
  partId,
  robotId,
  modelKey,
  view,
  onView,
  className = "",
  locateButton = true,
  onExpand,
  flat = false,
  sources,
}: ModelProps & { className?: string; locateButton?: boolean; onExpand?: () => void }) {
  const [models, setModels] = useState<Partial<Record<StageView, ViewerModel>>>({});
  const [errors, setErrors] = useState<Partial<Record<StageView, string>>>({});
  const [found, setFound] = useState<boolean | null>(null);
  const onLocated = useCallback((f: boolean) => setFound(f), []);
  // Each switch between the part and the robot looks for the part again.
  const [foundFor, setFoundFor] = useState(view);
  if (foundFor !== view) {
    setFoundFor(view);
    setFound(null);
  }
  const model = models[view];
  const error = errors[view];
  const [robotParts, setRobotParts] = useState<Map<string, ModelPart>>(() => new Map());
  const router = useRouter();
  // Every view measures, the part window's small preview too (Harel, 2026-11-21): a click picks a
  // face, edge or corner; that preview opens big from its expand button.
  const picks = useMeasurePicks();
  const { picked, clear: clearPicks } = picks;
  // Its window opens on top; the picks clear so Esc there closes that window, not the picks here.
  const openPicked = (p: ModelPart) => {
    clearPicks();
    void import("@/components/bom/PartDetailsHost").then((m) => m.openPartWindow(p.id));
  };
  const pageMenu: PageMenu = (keys) => {
    if (view !== "locate") return [];
    const found = [...new Set(keys)].flatMap((k) => robotParts.get(k) ?? []);
    const one = found.length === 1 ? found[0] : undefined;
    const systems = new Set(found.map((p) => p.systemId));
    const system = systems.size === 1 && robotId ? [...systems][0] : null;
    return [
      ...(one ? [{ label: "Open part", run: () => openPicked(one) }] : []),
      // The BOM's version in Onshape, not the workspace (Harel, 2026-11-19).
      ...(one?.onshape ? [openInOnshape(one.onshape)] : []),
      ...(system
        ? [
            {
              label: "Open system",
              run: () => {
                // Leaving for the system page closes the windows over this one.
                document.querySelectorAll("dialog[open]").forEach((d) => (d as HTMLDialogElement).close());
                router.push(`/robots/${robotId}/systems/${system}`);
              },
            },
          ]
        : []),
    ];
  };
  // Esc drops the picks before it closes the window (capture: ahead of the window's own Esc).
  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      clearPicks();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [picked, clearPicks]);

  // Open flatten's cost hint: free once the flat pattern is kept (one R2 check, no Onshape calls).
  const [flatKept, setFlatKept] = useState(false);
  useEffect(() => {
    if (!flat || sources) return;
    let cancelled = false;
    fetch(`/api/parts/${partId}/flat`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { cached?: boolean } | null) => !cancelled && body?.cached && setFlatKept(true))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [flat, partId, sources]);

  useEffect(() => {
    if (models[view] || errors[view]) return;
    let cancelled = false;
    const source = sources?.[view];
    const load = source
      ? fetch(source)
      : view === "part"
        ? fetch(`/api/parts/${partId}/model`, { method: "POST" })
        : view === "flat"
          ? fetch(`/api/parts/${partId}/flat`, { method: "POST" })
          : fetch(`/api/robots/${robotId}/model?parts=1&model=bom`);
    load
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { model?: ViewerModel | null; parts?: ModelPart[]; error?: string };
        if (cancelled) return;
        if (body.parts) setRobotParts(new Map(body.parts.map((p) => [p.key, p])));
        if (body.model) {
          setModels((m) => ({ ...m, [view]: body.model! }));
          if (view === "flat") setFlatKept(true);
        }
        else
          setErrors((e) => ({
            ...e,
            [view]:
              body.error ??
              (view === "locate"
                ? "The robot's 3D model isn't exported yet. Press Update 3D model on the robot page (CAD Team)."
                : view === "flat"
                  ? `The flat pattern failed (${res.status}).`
                  : `The 3D preview failed (${res.status}).`),
          }));
      })
      .catch(() => !cancelled && setErrors((e) => ({ ...e, [view]: "The 3D preview couldn't load. Try again." })));
    return () => {
      cancelled = true;
    };
  }, [view, partId, robotId, models, errors, sources]);

  const missing = view === "locate" && model && found === false;

  return (
    <div className={`relative ${className}`}>
      {model && (
        <ModelCanvas
          key={view}
          model={model}
          colors={NO_COLORS}
          mode="cad"
          locateKey={view === "locate" ? modelKey : null}
          onLocated={onLocated}
          onTools={picks.setTools}
          onMeasure={picks.setMeasured}
          {...(!onExpand && { menu: pageMenu })}
          // The view cube, as on CAD's pages (Harel, 2026-11-11); not on the small preview in the
          // part details window, which opens big with a click.
          cube={!onExpand}
          {...(view === "locate" && { names: new Map([...robotParts].map(([k, p]) => [k, p.name])) })}
        />
      )}
      {onExpand ? <MeasureBox measured={picks.measured} compact className="bottom-12 sm:bottom-14" /> : <MeasureBox measured={picks.measured} />}
      {onExpand && model && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          aria-label="Open the 3D view big"
          title="Open the 3D view big"
          className="btn absolute bottom-2 left-1/2 z-10 h-7 -translate-x-1/2 bg-surface/95 px-2 shadow-sm active:scale-[0.98] sm:bottom-3 sm:h-8 pointer-coarse:size-10 pointer-coarse:justify-center pointer-coarse:p-0"
        >
          <Icon name="expand" className="h-3.5 w-3.5" />
        </button>
      )}
      {(error || !model || missing) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
          {error ??
            (missing
              ? "This part isn't in the robot's linked Onshape assemblies."
              : view === "part"
                ? "Loading the part…"
                : view === "flat"
                  ? "Loading the flat pattern…"
                  : "Loading the robot…")}
        </div>
      )}
      {((locateButton && robotId && modelKey) || flat) && (
        <div className={`absolute z-10 flex flex-wrap gap-1.5 ${onExpand ? "top-2 left-2 sm:top-3 sm:left-3" : "top-3 left-3"}`}>
          {flat && view !== "locate" && (
            // Top left of the preview (Harel, 2026-11-17): the flat pattern, then back to the part.
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onView(view === "flat" ? "part" : "flat");
              }}
              aria-pressed={view === "flat"}
              className="btn h-7 gap-1.5 bg-surface/95 px-2 text-xs shadow-sm sm:h-8 sm:px-3 pointer-coarse:h-9"
              {...(view !== "flat" && costHint(openFlatCost(flatKept)))}
            >
              <Icon name={view === "flat" ? "cube" : "layers"} className="h-3.5 w-3.5" />
              {view === "flat" ? "Show folded" : "Open flatten"}
            </button>
          )}
          {locateButton && robotId && modelKey && view !== "flat" && (
            <button onClick={() => onView(view === "part" ? "locate" : "part")} className="btn h-8 gap-1.5 bg-surface/95 text-xs shadow-sm">
              <Icon name={view === "part" ? "locate" : "cube"} className="h-3.5 w-3.5" />
              {view === "part" ? "Locate in robot" : "Part only"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
