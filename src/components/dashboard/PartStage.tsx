"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMaterialColors } from "@/components/shell/MaterialColors";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { materialColor } from "@/config/materialColors";
import type { ViewerModel } from "./ModelCanvas";

const ModelCanvas = dynamic(() => import("./ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });
const NO_COLORS = new Map<string, string>();

export type StageView = "part" | "locate";

// A part's 3D window in the middle of the screen, opened from its card without leaving the
// page: the part on its own ("part"), or where it sits in the see-through robot ("locate").
// The corner button switches between the two; on its own the part can show its material colour.
export function PartStage({
  partId,
  robotId,
  modelKey,
  name,
  material,
  onshapeMaterial,
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
        <PartModel partId={partId} robotId={robotId} modelKey={modelKey} material={material} onshapeMaterial={onshapeMaterial} view={view} onView={onView} className="flex-1" />
      </div>
    </dialog>
  );
}

type ModelProps = {
  partId: string;
  robotId: string | null;
  modelKey: string | null;
  material: string | null;
  onshapeMaterial: string | null;
  view: StageView;
  onView: (view: StageView) => void;
};

// The live 3D stage itself, in a window (PartStage) or inline (the part details window, which
// draws its own Locate button: `locateButton={false}`).
export function PartModel({
  partId,
  robotId,
  modelKey,
  material,
  onshapeMaterial,
  view,
  onView,
  className = "",
  locateButton = true,
}: ModelProps & { className?: string; locateButton?: boolean }) {
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
  const [colors, setColors] = useState<"plain" | "material">("plain");
  const materialOverrides = useMaterialColors();
  const partColors = useMemo(() => {
    if (view !== "part" || colors !== "material" || !model) return NO_COLORS;
    const color = materialColor(material, materialOverrides, onshapeMaterial);
    return new Map(model.placements.map((p) => [p.k, color]));
  }, [view, colors, model, material, onshapeMaterial, materialOverrides]);

  useEffect(() => {
    if (models[view] || errors[view]) return;
    let cancelled = false;
    const load =
      view === "part"
        ? fetch(`/api/parts/${partId}/model`, { method: "POST" })
        : fetch(`/api/robots/${robotId}/model`);
    load
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { model?: ViewerModel | null; error?: string };
        if (cancelled) return;
        if (body.model) setModels((m) => ({ ...m, [view]: body.model! }));
        else
          setErrors((e) => ({
            ...e,
            [view]:
              body.error ??
              (view === "locate" ? "The robot's 3D model isn't exported yet. Press Update 3D model on the robot page in Edit mode." : `The 3D preview failed (${res.status}).`),
          }));
      })
      .catch(() => !cancelled && setErrors((e) => ({ ...e, [view]: "The 3D preview couldn't load. Try again." })));
    return () => {
      cancelled = true;
    };
  }, [view, partId, robotId, models, errors]);

  const missing = view === "locate" && model && found === false;

  return (
    <div className={`relative bg-[radial-gradient(ellipse_at_50%_35%,var(--color-surface)_0%,var(--color-raised)_75%)] ${className}`}>
      {model && <ModelCanvas key={view} model={model} colors={partColors} mode={partColors === NO_COLORS ? "plain" : "status"} locateKey={view === "locate" ? modelKey : null} onLocated={onLocated} />}
      {(error || !model || missing) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
          {error ?? (missing ? "This part isn't in the robot's linked Onshape assemblies." : view === "part" ? "Loading the part…" : "Loading the robot…")}
        </div>
      )}
      {view === "part" && model && (
        <div className="absolute top-3 left-3">
          <Segmented
            label="Part colour"
            value={colors}
            onChange={setColors}
            options={[
              { value: "plain", label: "Plain" },
              { value: "material", label: "Material" },
            ]}
          />
        </div>
      )}
      {locateButton && robotId && modelKey && (
        <button onClick={() => onView(view === "part" ? "locate" : "part")} className="btn absolute top-3 right-3 h-8 gap-1.5 bg-surface/95 text-xs shadow-sm">
          <Icon name={view === "part" ? "locate" : "cube"} className="h-3.5 w-3.5" />
          {view === "part" ? "Locate in robot" : "Part only"}
        </button>
      )}
    </div>
  );
}
