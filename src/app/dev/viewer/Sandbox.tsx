"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { HiddenParts, MeasureInfo, NamedViews, SceneTools, ViewerMode, ViewerModel } from "@/components/dashboard/ModelCanvas";
import { ViewerToolbar } from "@/components/review/ViewerToolbar";
import { MeasureBox } from "@/components/viewer/MeasureBox";
import { DesignCheck } from "@/components/check/DesignCheck";
import { showOverlap } from "@/components/check/showOverlap";
import { applyView, captureView, hashWithView, type ViewState } from "@/components/viewer/viewState";
import { Segmented } from "@/components/ui/Segmented";

const ModelCanvas = dynamic(() => import("@/components/dashboard/ModelCanvas").then((m) => m.ModelCanvas), { ssr: false });

// Stand-ins for status colours, one per part in turn, so Status mode shows something.
const FAKE_STATUS = ["#22c55e", "#f59e0b", "#38bdf8", "#ef4444", "#a78bfa"];

// The CAD screen's 3D view, cut down: ModelCanvas and ViewerToolbar on the sandbox robot, with the
// CAD page's measure box (no pick pop-up: the right-click menu does it, as on CAD since R2),
// colours, subsystems and Locate, so every
// viewer tool can be tried locally. Not the real CAD page: comments, versions and snips stay there.
export function Sandbox() {
  const [data, setData] = useState<{ model: ViewerModel; names: Record<string, string> } | null>(null);
  const [failed, setFailed] = useState(false);
  const [tools, setTools] = useState<SceneTools | null>(null);
  const [measured, setMeasured] = useState<MeasureInfo>({ picks: [], rows: [], parts: [] });
  const [hidden, setHidden] = useState<HiddenParts | null>(null);
  const [mode, setMode] = useState<ViewerMode>("cad");
  const [groupsOff, setGroupsOff] = useState<Set<number>>(() => new Set());
  const [locate, setLocate] = useState<string | null>(null);
  const [located, setLocated] = useState<boolean | null>(null);

  useEffect(() => {
    // ?big=1: the big robot for the loading check (plan/cad-3d-viewer.md S2).
    const sp = new URLSearchParams(window.location.search);
    const q = new URLSearchParams({ ...(sp.get("big") === "1" ? { big: "1" } : {}), ...(sp.get("sketches") === "1" ? { sketches: "1" } : {}) }).toString();
    fetch(`/api/dev/viewer${q ? `?${q}` : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);
  const names = useMemo(() => new Map(Object.entries(data?.names ?? {})), [data]);
  const colors = useMemo(() => new Map([...names.keys()].map((k, i) => [k, FAKE_STATUS[i % FAKE_STATUS.length]])), [names]);
  const onLocated = useCallback((found: boolean) => setLocated(found), []);
  const checkSystems = useMemo(() => {
    const groups = data?.model.groups ?? [];
    const of = new Map<string, string[]>();
    for (const p of data?.model.placements ?? []) of.set(p.k, groups[p.g ?? 0]?.systemIds ?? []);
    return { of, list: groups.map((g) => ({ id: g.systemIds[0], name: g.name })) };
  }, [data]);
  const checkData = useMemo(() => {
    const facts: Record<string, { material: string | null; onshapeMaterial: string | null; printed: boolean; setG: number | null }> = {};
    for (const k of names.keys()) {
      if (/TUBE|PLATE/.test(k)) facts[k] = { material: "6061 Aluminum", onshapeMaterial: null, printed: false, setG: null };
      if (/PC_/.test(k)) facts[k] = { material: "Polycarbonate", onshapeMaterial: null, printed: false, setG: null };
    }
    return { limits: { weightKg: 50, perimeterMm: 2800, heightMm: 1000, frameZoneMm: 60 }, facts, ignored: [], latest: null };
  }, [names]);
  // Named views (S6), kept in memory here (the CAD pages keep them per robot in the database);
  // `window.viewerTools` lets a check in the browser console drive the pins and views.
  const [saved, setSaved] = useState<{ id: string; name: string; view: ViewState }[]>([]);
  // `window.designCheck()` runs the CAD page's Design check (plan/design-check.md) on the sandbox
  // robot, with no limits and no materials known.
  useEffect(() => {
    const w = window as unknown as { viewerTools?: SceneTools | null; designCheck?: () => Promise<unknown>; checkProgress?: unknown; checkLib?: unknown };
    w.viewerTools = tools;
    w.designCheck = async () => {
      if (!tools || !data) return null;
      const { runCheck } = await import("@/components/check/runCheck");
      w.checkLib = await import("@/lib/check/clash");
      await tools.whenLoaded();
      return runCheck(tools.checkParts(), { model: data.model, names, systemsOf: new Map(), facts: {}, limits: {}, ignored: new Set() }, (step, done, total) => (w.checkProgress = { step, done, total, at: Math.round(performance.now()) }));
    };
  }, [tools, data, names]);
  const views: NamedViews | undefined = tools
    ? {
        list: saved.map((v) => ({ id: v.id, name: v.name, by: null, mine: true })),
        open: (id) => {
          const v = saved.find((x) => x.id === id);
          if (v) applyView(tools, v.view, true);
        },
        save: async (name) => {
          setSaved((l) => [...l.filter((v) => v.name !== name.trim()), { id: String(Date.now()), name: name.trim(), view: captureView(tools) }]);
          return null;
        },
        remove: (id) => setSaved((l) => l.filter((v) => v.id !== id)),
        copyLink: async () => {
          const url = location.origin + location.pathname + location.search + hashWithView(captureView(tools));
          history.replaceState(history.state, "", url);
          return navigator.clipboard.writeText(url).then(() => true, () => false);
        },
      }
    : undefined;

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
          views={views}
          menu={(keys) => (keys.length === 1 ? [{ label: "Open part (sandbox: no BOM)", run: () => alert(names.get(keys[0]) ?? keys[0]) }] : [])}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">{failed ? "The sandbox robot couldn't load." : "Loading the sandbox…"}</div>
      )}

      {/* The CAD page's Design check on the sandbox robot: nothing saved, a few parts with a
          known material so the weight has both kinds. */}
      {data && (
        <div className="absolute top-14 left-3 z-10 max-h-[calc(100%-8rem)] w-80 overflow-y-auto rounded-lg bg-surface/95 shadow-md backdrop-blur max-sm:w-[calc(100%-1.5rem)]">
          <DesignCheck
            robotId="sandbox"
            kind="final"
            model={data.model}
            tools={tools}
            names={names}
            systemsOf={checkSystems.of}
            systems={checkSystems.list}
            onlySystem={null}
            canCheck
            canManage
            onShow={(f) => {
              tools?.isolate(f.keys, { ghost: 0.35 });
              tools?.zoomTo(f.keys);
            }}
            onOverlap={(c) => tools && showOverlap(tools, c)}
            onComment={(f) => alert(`Comment (sandbox): ${f.body}`)}
            sandbox={checkData}
          />
        </div>
      )}

      <p className="absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-md max-sm:hidden border border-line bg-surface/95 px-2.5 py-1.5 text-xs font-semibold text-muted shadow-sm">3D sandbox · not real data</p>

      <MeasureBox measured={measured} />

      <ViewerToolbar tools={tools} hidden={hidden}>
        <Segmented
          label="Part colours"
          value={mode}
          onChange={setMode}
          options={[
            { value: "cad", label: "CAD" },
            { value: "status", label: "Status" },
            { value: "tint", label: "Tint" },
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
