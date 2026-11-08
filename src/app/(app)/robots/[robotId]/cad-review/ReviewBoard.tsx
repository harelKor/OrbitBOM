"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ViewerModel } from "@/components/dashboard/ModelCanvas";
import { LazyMount } from "@/components/review/LazyMount";

const ModelCanvas = dynamic(() => import("@/components/dashboard/ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });
const NO_COLORS = new Map<string, string>();
const noop = () => {};

export type BoardSystem = { id: string; name: string; open: number; done: number };

// The robot's 3D model, one box per system and the whole robot below. A system's box is the
// robot's model with only that system's placements (and only its Part Studio files to load).
export function ReviewBoard({ robotId, systems, builtAt, edit }: { robotId: string; systems: BoardSystem[]; builtAt: string | null; edit: boolean }) {
  const router = useRouter();
  const [model, setModel] = useState<ViewerModel | null | undefined>(builtAt ? undefined : null);
  useEffect(() => {
    if (!builtAt) return;
    let cancelled = false;
    fetch(`/api/robots/${robotId}/model`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { model: ViewerModel | null } | null) => !cancelled && setModel(d?.model ?? null))
      .catch(() => !cancelled && setModel(null));
    return () => {
      cancelled = true;
    };
  }, [robotId, builtAt]);

  const bySystem = useMemo(() => {
    const out = new Map<string, ViewerModel>();
    if (!model) return out;
    for (const s of systems) {
      const groups = new Set((model.groups ?? []).flatMap((g, i) => (g.systemIds.includes(s.id) ? [i] : [])));
      const placements = model.placements.filter((p) => groups.has(p.g ?? 0));
      if (!placements.length) continue;
      const used = new Set(placements.map((p) => p.s));
      out.set(s.id, { studios: model.studios.map((u, i) => (used.has(i) ? u : null)), placements, groups: model.groups });
    }
    return out;
  }, [model, systems]);
  // A placement's system, for a tap on the whole robot.
  const systemOfKey = useMemo(() => {
    const out = new Map<string, string>();
    for (const p of model?.placements ?? []) {
      const id = model?.groups?.[p.g ?? 0]?.systemIds.find((sid) => systems.some((s) => s.id === sid));
      if (id) out.set(p.k, id);
    }
    return out;
  }, [model, systems]);
  const open = (id: string) => router.push(`/robots/${robotId}/systems/${id}/cad-review`);

  const empty = (text: string) => <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted">{text}</div>;
  const missing = edit ? "Press Update 3D model on the robot page to export it from Onshape." : "Shows here once the CAD Team exports the robot's 3D model.";

  if (!systems.length) return <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted">No system of this robot is linked to Onshape yet.</div>;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {systems.map((s) => {
          const own = bySystem.get(s.id);
          return (
            <div key={s.id} className="stage-frame stage-glow relative h-56 overflow-hidden md:h-64">
              <LazyMount className="absolute inset-0">
                {own ? (
                  <ModelCanvas model={own} colors={NO_COLORS} mode="cad" locateKey={null} onLocated={noop} onPick={() => open(s.id)} />
                ) : model === undefined ? (
                  empty("Loading…")
                ) : (
                  <button className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted" onClick={() => open(s.id)}>
                    {model ? "Not in the 3D model yet. " : ""}
                    {missing}
                  </button>
                )}
              </LazyMount>
              <button
                onClick={() => open(s.id)}
                className="press absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md border border-line bg-surface/90 px-2.5 py-1 text-sm font-semibold text-fg shadow-sm backdrop-blur hover:border-accent/60 active:scale-[0.98] pointer-coarse:min-h-9"
              >
                <span className="truncate">{s.name}</span>
                {s.open > 0 && <span className="rounded-full bg-amber-500/15 px-1.5 text-xs text-amber-600 tabular-nums">{s.open}</span>}
                {s.done > 0 && <span className="rounded-full bg-sky-500/15 px-1.5 text-xs text-sky-600 tabular-nums" title="Waiting for a mentor">✓{s.done}</span>}
              </button>
            </div>
          );
        })}
      </div>
      <div className="stage-frame stage-glow relative h-[60dvh] min-h-80 overflow-hidden">
        <LazyMount className="absolute inset-0">
          {model ? (
            <ModelCanvas model={model} colors={NO_COLORS} mode="cad" locateKey={null} onLocated={noop} onPick={(key) => key && systemOfKey.get(key) && open(systemOfKey.get(key)!)} />
          ) : (
            empty(model === undefined ? "Loading the robot…" : missing)
          )}
        </LazyMount>
        <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-surface/90 px-2.5 py-1 text-sm font-semibold text-fg shadow-sm">Whole robot · tap a part to open its system</span>
      </div>
    </div>
  );
}
