"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { ModelPart } from "@/lib/data/parts";
import { MeasureBox } from "@/components/viewer/MeasureBox";
import type { PageMenu, ViewerModel } from "./ModelCanvas";
import { useMeasurePicks } from "./useMeasurePicks";

const ModelCanvas = dynamic(() => import("./ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });
const NO_COLORS = new Map<string, string>();

export type StageView = "part" | "locate";

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
          <Icon name={view === "part" ? "cube" : "locate"} className="h-4 w-4 text-accent-hover" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</h2>
          <button onClick={() => dialog.current?.close()} className="press rounded p-1 text-muted hover:text-fg" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <PartModel partId={partId} robotId={robotId} modelKey={modelKey} view={view} onView={onView} className="flex-1" />
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
  // A small preview (onExpand: the part window's) opens big with a click; the big ones pick.
  const picks = useMeasurePicks(!onExpand);
  const { picked, clear: clearPicks } = picks;
  // Its window opens on top; the picks clear so Esc there closes that window, not the picks here.
  const openPicked = (p: ModelPart) => {
    clearPicks();
    void import("@/components/bom/PartDetailsHost").then((m) => m.openPartWindow(p.id));
  };
  const onPick = () => onExpand?.();
  const pageMenu: PageMenu = (keys) => {
    if (view !== "locate") return [];
    const found = [...new Set(keys)].flatMap((k) => robotParts.get(k) ?? []);
    const one = found.length === 1 ? found[0] : undefined;
    const systems = new Set(found.map((p) => p.systemId));
    const system = systems.size === 1 && robotId ? [...systems][0] : null;
    return [
      ...(one ? [{ label: "Open part", run: () => openPicked(one) }] : []),
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

  useEffect(() => {
    if (models[view] || errors[view]) return;
    let cancelled = false;
    const load =
      view === "part"
        ? fetch(`/api/parts/${partId}/model`, { method: "POST" })
        : fetch(`/api/robots/${robotId}/model?parts=1`);
    load
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { model?: ViewerModel | null; parts?: ModelPart[]; error?: string };
        if (cancelled) return;
        if (body.parts) setRobotParts(new Map(body.parts.map((p) => [p.key, p])));
        if (body.model) setModels((m) => ({ ...m, [view]: body.model! }));
        else
          setErrors((e) => ({
            ...e,
            [view]:
              body.error ??
              (view === "locate" ? "The robot's 3D model isn't exported yet. Press Update 3D model on the robot page (CAD Team)." : `The 3D preview failed (${res.status}).`),
          }));
      })
      .catch(() => !cancelled && setErrors((e) => ({ ...e, [view]: "The 3D preview couldn't load. Try again." })));
    return () => {
      cancelled = true;
    };
  }, [view, partId, robotId, models, errors]);

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
          onPick={onPick}
          {...(!onExpand && { onTools: picks.setTools, onMeasure: picks.setMeasured, menu: pageMenu })}
          // The view cube, as on CAD's pages (Harel, 2026-11-11); not on the small preview in the
          // part details window, which opens big with a click.
          cube={!onExpand}
          {...(view === "locate" && { names: new Map([...robotParts].map(([k, p]) => [k, p.name])) })}
        />
      )}
      {!onExpand && <MeasureBox measured={picks.measured} />}
      {(error || !model || missing) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
          {error ?? (missing ? "This part isn't in the robot's linked Onshape assemblies." : view === "part" ? "Loading the part…" : "Loading the robot…")}
        </div>
      )}
      {locateButton && robotId && modelKey && (
        <button onClick={() => onView(view === "part" ? "locate" : "part")} className="btn absolute top-3 left-3 z-10 h-8 gap-1.5 bg-surface/95 text-xs shadow-sm">
          <Icon name={view === "part" ? "locate" : "cube"} className="h-3.5 w-3.5" />
          {view === "part" ? "Locate in robot" : "Part only"}
        </button>
      )}
    </div>
  );
}
