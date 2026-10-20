"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { StatusCount } from "@/lib/stats";
import { Segmented } from "@/components/ui/Segmented";
import { Icon } from "@/components/ui/Icon";
import type { ViewerModel } from "./ModelCanvas";

const ModelCanvas = dynamic(() => import("./ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });

type BuildAnswer =
  | { state: "done"; unchanged: boolean; parts: number; calls: number }
  | { state: "working"; done: number; total: number; calls: number }
  | { error: string };

// The 3D robot stage. The model is built from the systems' Onshape assemblies on demand
// (Edit mode's Update 3D model) and kept in R2; viewing it costs no Onshape calls.
export function RobotViewer({
  robotId,
  statuses,
  parts,
  locate,
  builtAt,
  hasAssembly,
  edit,
}: {
  robotId: string;
  statuses: StatusCount[];
  parts: { key: string; color: string }[]; // BOM parts by Onshape identity, with status colour
  locate: { name: string; key: string | null } | null;
  builtAt: string | null;
  hasAssembly: boolean;
  edit: boolean;
}) {
  const [colors, setColors] = useState<"status" | "plain">("status");
  const [dismissed, setDismissed] = useState(false);
  const [version, setVersion] = useState(builtAt);
  // undefined while loading, null when there is no model to show.
  const [model, setModel] = useState<ViewerModel | null | undefined>(builtAt ? undefined : null);
  const [found, setFound] = useState<boolean | null>(null);
  const [building, setBuilding] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const colorMap = useMemo(() => new Map(parts.map((p) => [p.key, p.color])), [parts]);
  const onLocated = useCallback((f: boolean) => setFound(f), []);

  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    fetch(`/api/robots/${robotId}/model`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { model: ViewerModel | null } | null) => !cancelled && setModel(d?.model ?? null))
      .catch(() => {
        if (cancelled) return;
        setModel(null);
        setMessage({ text: "The 3D model couldn't load. Try reloading the page.", error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [robotId, version]);

  async function build() {
    setMessage(null);
    setBuilding("Checking Onshape…");
    let calls = 0;
    try {
      for (let round = 0; round < 30; round++) {
        const res = await fetch(`/api/robots/${robotId}/model`, { method: "POST" });
        const a = (await res.json().catch(() => ({ error: `The export failed (${res.status}).` }))) as BuildAnswer;
        if ("error" in a) return setMessage({ text: a.error, error: true });
        calls += a.calls;
        if (a.state === "working") {
          setBuilding(`Exporting part studios ${a.done}/${a.total}…`);
          continue;
        }
        setMessage({
          text: a.unchanged
            ? `The 3D model is up to date (${calls} Onshape call${calls === 1 ? "" : "s"}).`
            : `3D model updated: ${a.parts} parts (${calls} Onshape calls).`,
        });
        if (!a.unchanged) setVersion(new Date().toISOString());
        return;
      }
      setMessage({ text: "Onshape is still exporting. Press Update 3D model again to continue.", error: true });
    } catch {
      setMessage({ text: "The export stopped. Press Update 3D model again to continue.", error: true });
    } finally {
      setBuilding(null);
    }
  }

  const locateText = !locate
    ? null
    : !model
      ? "It lights up once the robot model is exported."
      : found === false
        ? "It isn't in the linked Onshape assemblies."
        : null;

  return (
    <section id="viewer" className="panel flex min-h-80 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Icon name="cube" className="h-4 w-4 text-accent-hover" />
        <h2 className="text-sm font-semibold">3D Assembly Status View</h2>
        <div className="ml-auto flex items-center gap-2">
          {edit && hasAssembly && (
            <button className="btn h-8 text-xs" onClick={build} disabled={!!building}>
              {building ?? "Update 3D model"}
            </button>
          )}
          <Segmented
            label="Part colours"
            value={colors}
            onChange={setColors}
            options={[
              { value: "status", label: "Status" },
              { value: "plain", label: "Plain" },
            ]}
          />
        </div>
      </div>
      <div className="relative min-h-72 flex-1 overflow-hidden bg-[radial-gradient(ellipse_at_50%_35%,var(--color-surface)_0%,var(--color-raised)_75%)]">
        {model ? (
          <ModelCanvas model={model} colors={colorMap} mode={colors} locateKey={locate && !dismissed ? locate.key : null} onLocated={onLocated} />
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
                {model === undefined
                  ? "Loading the robot…"
                  : !hasAssembly
                    ? edit
                      ? "Link this robot's systems to their Onshape assemblies (from the Onshape panel or a system's gear), then press Update 3D model."
                      : "The robot model shows here once its systems are linked to Onshape."
                    : edit
                      ? "Press Update 3D model to export the robot from Onshape."
                      : "The robot model shows here once it's exported from Onshape in Edit mode."}
              </p>
            </div>
          </>
        )}
        {locate && !dismissed && (
          <div className="absolute top-3 left-3 flex max-w-[calc(100%-1.5rem)] animate-pop items-center gap-2 rounded-md border border-accent/50 bg-surface/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
            <Icon name="locate" className="h-4 w-4 shrink-0 text-accent-hover" />
            <span>
              {locateText ? "Locating" : "Showing"} <span className="font-semibold text-fg">{locate.name}</span>
              {locateText && `. ${locateText}`}
            </span>
            <button onClick={() => setDismissed(true)} className="press ml-1 text-muted hover:text-fg" aria-label="Close">
              ✕
            </button>
          </div>
        )}
        {message && (
          <div
            role="status"
            className={`absolute top-3 right-3 max-w-72 animate-pop rounded-md border bg-surface/95 px-3 py-2 text-xs shadow-sm backdrop-blur ${
              message.error ? "border-rose-400/60 text-rose-500" : "border-line text-fg-2"
            }`}
          >
            {message.text}
          </div>
        )}
        {colors === "status" && statuses.length > 0 && !(locate && !dismissed && model) && (
          <div className="pointer-events-none absolute right-3 bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-2">
            {statuses.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
