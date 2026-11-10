"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ViewerModel } from "@/components/dashboard/ModelCanvas";
import { LazyMount } from "@/components/review/LazyMount";

const ModelCanvas = dynamic(() => import("@/components/dashboard/ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });
const NO_COLORS = new Map<string, string>();
const noop = () => {};

export type BoardSystem = { id: string; name: string; thumbUrl: string | null; open: number; done: number };

// The robot's 3D model on top (a tap opens the robot's CAD page), then one box per system: on
// wide screens the robot's model with only that system's placements (and only its Part Studio
// files to load), on phones the system's picture, so a phone draws one 3D view, not a dozen
// (Harel, 2026-11-09).
export function ReviewBoard({
  robotId,
  robotName,
  robotCounts,
  systems,
  builtAt,
  edit,
}: {
  robotId: string;
  robotName: string;
  robotCounts: { open: number; done: number };
  systems: BoardSystem[];
  builtAt: string | null;
  edit: boolean;
}) {
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
  const systemHref = (id: string) => `/robots/${robotId}/systems/${id}/cad-review`;
  const robotHref = `/robots/${robotId}/cad-review/robot`;

  const empty = (text: string) => <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted">{text}</div>;
  const missing = edit ? "Press Update 3D model on the robot page to export it from Onshape." : "Shows here once the CAD Team exports the robot's 3D model.";

  return (
    <div className="space-y-4">
      <div className="stage-frame stage-glow relative h-[42dvh] min-h-64 overflow-hidden lg:h-[calc(52dvh+30px)]">
        <LazyMount className="absolute inset-0">
          {model ? (
            <ModelCanvas model={model} colors={NO_COLORS} mode="cad" locateKey={null} onLocated={noop} onPick={() => router.push(robotHref)} />
          ) : model === undefined ? (
            empty("Loading the robot…")
          ) : (
            <Link href={robotHref} className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted">
              {missing}
            </Link>
          )}
        </LazyMount>
        <Name href={robotHref} name={robotName} open={robotCounts.open} done={robotCounts.done} />
      </div>

      {systems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted">No system of this robot is linked to Onshape yet.</div>
      ) : (
        // As many boxes to a row as fit (at least 13rem each), the row filled edge to edge.
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
          {systems.map((s) => {
            const own = bySystem.get(s.id);
            return (
              <div key={s.id} className="stage-frame stage-glow relative aspect-square overflow-hidden lg:aspect-auto lg:h-[230px]">
                {/* Phones: the system's picture. */}
                <Link href={systemHref(s.id)} className="thumb-well absolute inset-0 flex items-center justify-center lg:hidden" aria-label={s.name}>
                  {s.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
                    <img src={s.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain p-3 pt-10" />
                  ) : (
                    <span className="text-xs text-muted">No picture</span>
                  )}
                </Link>
                {/* Wide screens: its 3D view, drawn while near the screen. */}
                <LazyMount className="absolute inset-0 max-lg:hidden">
                  {own ? (
                    <ModelCanvas model={own} colors={NO_COLORS} mode="cad" locateKey={null} onLocated={noop} onPick={() => router.push(systemHref(s.id))} />
                  ) : model === undefined ? (
                    empty("Loading…")
                  ) : (
                    <Link href={systemHref(s.id)} className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted">
                      {model ? "Not in the 3D model yet. " : ""}
                      {missing}
                    </Link>
                  )}
                </LazyMount>
                <Name href={systemHref(s.id)} name={s.name} open={s.open} done={s.done} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Name({ href, name, open, done }: { href: string; name: string; open: number; done: number }) {
  return (
    <Link
      href={href}
      className="press absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-md border border-line bg-surface/90 px-2.5 py-1 text-sm font-semibold text-fg shadow-sm backdrop-blur hover:border-accent/60 active:scale-[0.98] pointer-coarse:min-h-9"
    >
      <span className="truncate">{name}</span>
      {open > 0 && <span className="rounded-full bg-amber-500/15 px-1.5 text-xs text-amber-600 tabular-nums">{open}</span>}
      {done > 0 && (
        <span className="rounded-full bg-sky-500/15 px-1.5 text-xs text-sky-600 tabular-nums" title="Waiting for approval">
          ✓{done}
        </span>
      )}
    </Link>
  );
}
