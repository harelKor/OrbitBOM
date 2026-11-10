"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { HiddenParts, MeasureInfo, SceneTools, ViewerMode, ViewerModel } from "@/components/dashboard/ModelCanvas";
import { ViewerToolbar } from "@/components/review/ViewerToolbar";
import { Segmented } from "@/components/ui/Segmented";

const ModelCanvas = dynamic(() => import("@/components/dashboard/ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });

// Stand-ins for status colours, one per part in turn, so Status mode shows something.
const FAKE_STATUS = ["#22c55e", "#f59e0b", "#38bdf8", "#ef4444", "#a78bfa"];

// The CAD screen's 3D view, cut down: ModelCanvas and ViewerToolbar on the sandbox robot, with the
// picked-parts popup (Isolate, Hide), the measure readout, colours, subsystems and Locate, so every
// viewer tool can be tried locally. Not the real CAD page: comments, versions and snips stay there.
export function Sandbox() {
  const [data, setData] = useState<{ model: ViewerModel; names: Record<string, string> } | null>(null);
  const [failed, setFailed] = useState(false);
  const [tools, setTools] = useState<SceneTools | null>(null);
  const [measured, setMeasured] = useState<MeasureInfo>({ picks: [], rows: [], parts: [] });
  const [hidden, setHidden] = useState<HiddenParts | null>(null);
  const [isolated, setIsolated] = useState(false);
  const [mode, setMode] = useState<ViewerMode>("cad");
  const [groupsOff, setGroupsOff] = useState<Set<number>>(() => new Set());
  const [locate, setLocate] = useState<string | null>(null);
  const [located, setLocated] = useState<boolean | null>(null);

  useEffect(() => {
    // ?big=1: the big robot for the loading check (plan/cad-3d-viewer.md S2).
    fetch(`/api/dev/viewer${new URLSearchParams(window.location.search).get("big") === "1" ? "?big=1" : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);
  const names = useMemo(() => new Map(Object.entries(data?.names ?? {})), [data]);
  const colors = useMemo(() => new Map([...names.keys()].map((k, i) => [k, FAKE_STATUS[i % FAKE_STATUS.length]])), [names]);
  const onLocated = useCallback((found: boolean) => setLocated(found), []);

  // Points, edges and faces are picked at all times, like the CAD page; Esc drops them all.
  useEffect(() => {
    tools?.measure("any");
  }, [tools]);
  const clearPicks = useCallback(() => {
    tools?.measure(null);
    tools?.measure("any");
  }, [tools]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && clearPicks();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearPicks]);

  return (
    <main className="relative h-dvh overflow-hidden bg-surface">
      {data ? (
        <ModelCanvas
          model={data.model}
          colors={colors}
          mode={mode}
          locateKey={locate}
          onLocated={onLocated}
          hidden={groupsOff}
          names={names}
          onTools={setTools}
          onMeasure={setMeasured}
          onHidden={setHidden}
          onIsolated={(keys) => setIsolated(!!keys)}
          menu={(keys) => (keys.length === 1 ? [{ label: "Open part (sandbox: no BOM)", run: () => alert(names.get(keys[0]) ?? keys[0]) }] : [])}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">{failed ? "The sandbox robot couldn't load." : "Loading the sandbox…"}</div>
      )}

      <p className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-md max-sm:hidden border border-line bg-surface/95 px-2.5 py-1.5 text-xs font-semibold text-muted shadow-sm">3D sandbox · not real data</p>

      {measured.parts.length > 0 && (
        <div className="absolute z-20 flex w-60 max-w-[calc(100%-1.5rem)] animate-pop flex-col gap-2 rounded-md border border-accent/50 bg-surface/95 p-2.5 text-xs shadow-sm backdrop-blur max-lg:bottom-20 max-lg:left-1/2 max-lg:-translate-x-1/2 lg:top-3 lg:left-3">
          <ul className="max-h-36 space-y-0.5 overflow-y-auto">
            {measured.parts.map((k) => (
              <li key={k} className="truncate font-semibold text-fg">
                {names.get(k) ?? k}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              className="btn h-8 flex-1 justify-center px-2.5 text-xs pointer-coarse:h-9"
              onClick={() => {
                tools?.isolate(isolated ? null : measured.parts);
                setIsolated(!isolated);
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
        </div>
      )}

      {measured.picks.length > 0 && (
        <div className="absolute right-3 z-20 w-64 max-w-[calc(100%-1.5rem)] animate-pop rounded-md border border-line bg-surface/95 p-2.5 text-xs shadow-md backdrop-blur max-lg:bottom-40 lg:bottom-3">
          <ul className="max-h-32 space-y-0.5 overflow-y-auto">
            {measured.picks.map((p, k) => (
              <li key={k} className="truncate text-fg-2">
                {p}
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
        </div>
      )}

      <ViewerToolbar tools={tools} hidden={hidden}>
        <Segmented
          label="Part colours"
          value={mode}
          onChange={setMode}
          options={[
            { value: "cad", label: "CAD" },
            { value: "status", label: "Status" },
          ]}
        />
        {data?.model.groups && (
          <div className="flex flex-wrap gap-1 rounded-md border border-line bg-surface/95 p-1 text-xs shadow-sm">
            {data.model.groups.map((g, i) => (
              <label key={g.name} className="flex items-center gap-1 px-1.5 py-1 pointer-coarse:min-h-9">
                <input
                  type="checkbox"
                  checked={!groupsOff.has(i)}
                  onChange={() => {
                    const next = new Set(groupsOff);
                    if (!next.delete(i)) next.add(i);
                    setGroupsOff(next);
                  }}
                />
                {g.name}
              </label>
            ))}
          </div>
        )}
        <select
          value={locate ?? ""}
          onChange={(e) => setLocate(e.target.value || null)}
          aria-label="Locate a part"
          className="h-9 max-w-56 rounded-md border border-line bg-surface px-2 text-xs"
        >
          <option value="">Locate a part…</option>
          {[...names].slice(0, 60).map(([k, n]) => (
            <option key={k} value={k}>
              {n}
            </option>
          ))}
        </select>
        {locate && located === false && <p className="text-xs text-muted">Not in the model.</p>}
      </ViewerToolbar>
    </main>
  );
}
