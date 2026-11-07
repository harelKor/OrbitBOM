"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { ModelPart } from "@/lib/data/parts";
import type { ViewerModel } from "./ModelCanvas";
import { PickedPart } from "./PickedPart";

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
// draws its own Locate button: `locateButton={false}`). In the robot (Locate), parts pick as in
// the robot's own 3D view: a click names a part, one more click opens its window on top, Open
// system goes to its system page, and a click elsewhere or Esc clears it (Harel, 2026-11-07).
export function PartModel({
  partId,
  robotId,
  modelKey,
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
  const [robotParts, setRobotParts] = useState<Map<string, ModelPart>>(() => new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const picked = selected ? robotParts.get(selected) : undefined;
  // Its window opens on top; the pick clears so Esc there closes that window, not the pick here.
  const openPicked = (p: ModelPart) => {
    setSelected(null);
    void import("@/components/bom/PartDetailsHost").then((m) => m.openPartWindow(p.id));
  };
  const onPick = (key: string | null) => {
    const part = key ? robotParts.get(key) : undefined;
    if (key && key === selected && part) openPicked(part);
    else setSelected(key);
  };
  // Esc clears the pick before it closes the window (capture: ahead of the window's own Esc).
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setSelected(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [selected]);

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
          {...(view === "locate" && { selectedKey: selected, onPick, names: new Map([...robotParts].map(([k, p]) => [k, p.name])) })}
        />
      )}
      {view === "locate" && selected && (
        <PickedPart
          bottom
          name={picked?.name ?? null}
          onOpen={picked && (() => openPicked(picked))}
          systemHref={picked && robotId ? `/robots/${robotId}/systems/${picked.systemId}` : undefined}
          // Leaving for the system page closes the windows over this one.
          onSystem={() => document.querySelectorAll("dialog[open]").forEach((d) => (d as HTMLDialogElement).close())}
          onClear={() => setSelected(null)}
        />
      )}
      {(error || !model || missing) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">
          {error ?? (missing ? "This part isn't in the robot's linked Onshape assemblies." : view === "part" ? "Loading the part…" : "Loading the robot…")}
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
