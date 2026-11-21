"use client";

import { useEffect, useMemo, useState } from "react";
import { ModelCanvas, type PageMenu, type SceneTools, type ViewerModel } from "@/components/dashboard/ModelCanvas";
import { ModelToggle, type ModelKind } from "@/components/dashboard/ModelToggle";
import { VersionTree } from "@/components/review/VersionTree";
import { useVersionModel, VersionContext, type VersionPick, type VersionTarget } from "@/components/review/versionView";
import type { FrozenRef, TreeNode } from "@/lib/reviews/tree";
import { insertFromRobot, type RobotPick } from "../insert-actions";

type Sys = { id: string; name: string; tree: TreeNode[]; modelRef: FrozenRef | null; basepartTree: TreeNode[]; basepartRef: FrozenRef | null };
type Newest = Record<string, { versionId: string; label: string; at: string }>;

const NO_COLORS = new Map<string, string>();
const NO_COMMENTS = new Map();
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Insert from robot in the Onshape panel (Harel, 2026-11-21): the robot's 3D view with no
// comments, review or design check, at Low quality (the panel is narrow). Each system shows at its
// newest CAD update; with a system isolated, its version tree shows another version. Parts are
// picked by click (each click adds or drops one) or a box; right-click → Insert puts them in at the version shown.
export function InsertFromRobot({
  query,
  robotId,
  robotName,
  target,
  readOnly,
  builtAt,
  info,
  newest,
  systems,
}: {
  query: string;
  robotId: string;
  robotName: string;
  target: "partstudio" | "assembly";
  readOnly: boolean;
  builtAt: Record<ModelKind, string | null>;
  info: Record<string, { name: string; thumb: string | null }>;
  newest: Record<ModelKind, Newest>;
  systems: Sys[];
}) {
  const [kind, setKind] = useState<ModelKind>("final");
  const [model, setModel] = useState<ViewerModel | null | undefined>(undefined);
  const [isolated, setIsolated] = useState<string | null>(null);
  const [vt, setVt] = useState<VersionTarget | null>(null);
  const vload = useVersionModel(robotId, kind, vt, 0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [tools, setTools] = useState<SceneTools | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; skipped?: string[] } | null>(null);
  const nameMap = useMemo(() => new Map(Object.entries(info).map(([k, v]) => [k, v.name])), [info]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChosen([]);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  useEffect(() => {
    if (!builtAt[kind]) return;
    let live = true;
    fetch(`/api/robots/${robotId}/model${kind === "basepart" ? "?model=basepart" : ""}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { model: ViewerModel | null }) => live && setModel(d?.model ?? null))
      .catch(() => live && setModel(null));
    return () => {
      live = false;
    };
  }, [robotId, kind, builtAt]);
  // Low at first without changing what this device remembers for the CAD page.
  useEffect(() => tools?.setQuality(0, false), [tools]);

  const shown = vt ? (vload?.state === "ready" ? vload.model : null) : builtAt[kind] ? model : null;
  const groups = shown?.groups;
  const hidden = useMemo(() => (isolated && groups ? new Set(groups.flatMap((g, i) => (g.systemIds.includes(isolated) ? [] : [i]))) : undefined), [isolated, groups]);
  const systemOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of shown?.placements ?? []) {
      const sid = groups?.[p.g ?? 0]?.systemIds[0];
      if (sid && !m.has(p.k)) m.set(p.k, sid);
    }
    return m;
  }, [shown, groups]);
  const sysName = (id: string) => systems.find((s) => s.id === id)?.name ?? "System";

  // The version each system shows: the visited one, else its newest CAD update.
  const versionOf = (sid: string): { versionId: string } | { error: string } => {
    if (vt) {
      const e = vt.a.entries.find((x) => x.owner === sid);
      if (!e) return { error: `${sysName(sid)} isn't in the version shown.` };
      if (e.ref.wvm !== "v") return { error: `${vt.a.label} is a sub-version with no Onshape version to insert from. Pick a version (V…).` };
      return { versionId: e.ref.wvmid };
    }
    const n = newest[kind][sid];
    return n ? { versionId: n.versionId } : { error: `${sysName(sid)} has no CAD update with an Onshape version yet (Update CAD in its panel makes one).` };
  };

  async function insert(keys: string[]) {
    if (readOnly) return setResult({ ok: false, text: "Open the document's workspace (not a version) to insert into it." });
    const bySystem = new Map<string, string[]>();
    for (const k of keys) {
      const sid = systemOf.get(k);
      if (sid) bySystem.set(sid, [...(bySystem.get(sid) ?? []), k]);
    }
    const picks: RobotPick[] = [];
    for (const [sid, ks] of bySystem) {
      const v = versionOf(sid);
      if ("error" in v) return setResult({ ok: false, text: v.error });
      picks.push({ systemId: sid, versionId: v.versionId, keys: ks });
    }
    if (!picks.length) return setResult({ ok: false, text: "Those parts aren't in a system." });
    setBusy(true);
    setResult(null);
    const r = await insertFromRobot(query, kind, picks).catch(() => ({ error: "Insert failed. Try again.", message: undefined, skipped: [] }));
    setBusy(false);
    setResult(r.error ? { ok: false, text: [r.message, r.error].filter(Boolean).join(" "), skipped: r.skipped } : { ok: true, text: r.message ?? "Inserted.", skipped: r.skipped });
    if (!r.error) setChosen([]);
  }

  const menu: PageMenu = (keys) => {
    if (!keys.length) return [];
    const all = keys.some((k) => chosen.includes(k)) ? [...new Set([...chosen, ...keys])] : keys;
    const sid = systemOf.get(keys[0]);
    return [
      { label: all.length > 1 ? `Insert ${all.length} parts` : "Insert", run: () => void insert(all) },
      ...(sid && isolated !== sid ? [{ label: `Isolate ${sysName(sid)}`, run: () => isolate(sid) }] : []),
    ];
  };
  const isolate = (sid: string | null) => {
    setIsolated(sid);
    setVt(null);
  };
  // A click adds the part, a click on a picked one drops it, no Ctrl or Shift needed; a click on
  // empty space clears (Harel, 2026-11-21).
  const onPick = (key: string | null) => {
    if (!key) return setChosen([]);
    setChosen((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  };
  const versionLabel = (sid: string): { ok: boolean; text: string } => {
    if (vt) {
      const e = vt.a.entries.find((x) => x.owner === sid);
      return e && e.ref.wvm === "v" ? { ok: true, text: vt.a.label } : { ok: false, text: e ? `${vt.a.label} (sub-version: can't insert)` : "not in this version" };
    }
    const n = newest[kind][sid];
    return n ? { ok: true, text: `${n.label} (CAD update ${day(n.at)})` } : { ok: false, text: "no CAD update yet" };
  };
  const onBox = (keys: string[], drop: boolean) => setChosen((c) => (drop ? c.filter((k) => !keys.includes(k)) : [...new Set([...c, ...keys])]));

  const sys = systems.find((s) => s.id === isolated) ?? null;
  const tree = sys ? (kind === "basepart" ? sys.basepartTree : sys.tree) : [];
  const ref = sys ? (kind === "basepart" ? sys.basepartRef : sys.modelRef) : null;
  const current: VersionPick | null = sys && ref ? { key: "current", label: "Current", at: null, entries: [{ owner: sys.id, ref }] } : null;
  const newestOf = sys ? newest[kind][sys.id] : null;
  const shownLabel = vt ? vt.a.label : newestOf ? `${newestOf.label} (CAD update ${day(newestOf.at)})` : sys ? "No CAD update yet" : "Each system at its newest CAD update";
  const cadHref = `/robots/${robotId}/cad-review?${isolated ? `system=${isolated}&` : ""}${kind === "basepart" ? "model=basepart" : ""}`;
  // A compare or Commit window from the tree's ⋮ just shows that version here.
  const show = (t: VersionTarget | null) => setVt(t ? { mode: "visit", a: t.a, b: null } : null);

  return (
    <VersionContext.Provider value={{ target: vt, show, kind, robotId, canDelete: false }}>
      <div className="flex min-h-dvh flex-col gap-2 p-3 text-sm">
        <div className="flex items-center justify-end gap-2">
          <a href={cadHref} target="_blank" rel="noopener" className="btn min-h-9 px-2 text-xs active:scale-[0.98]">
            Open CAD page ↗
          </a>
        </div>
        <div>
          <p className="text-xs text-muted">Insert into this {target === "partstudio" ? "Part Studio" : "assembly"}</p>
          <h1 className="text-lg font-bold text-fg">{robotName}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {builtAt.basepart && (
            <ModelToggle
              value={kind}
              onChange={(k) => {
                setKind(k);
                setVt(null);
                setChosen([]);
                setModel(undefined);
              }}
            />
          )}
          <select className="input min-h-9 min-w-0 flex-1" value={isolated ?? ""} onChange={(e) => isolate(e.target.value || null)} aria-label="Isolate a system">
            <option value="">Whole robot</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted">
          Showing: <span className="font-semibold text-fg">{shownLabel}</span>
        </p>
        <div className="relative h-[55dvh] min-h-64 overflow-hidden rounded-lg border border-border bg-surface">
          {shown ? (
            <ModelCanvas
              key={vt ? `v:${vt.a.key}` : `live:${kind}`}
              model={shown}
              colors={NO_COLORS}
              mode="cad"
              locateKey={null}
              onLocated={() => {}}
              hidden={hidden}
              selectedKey={chosen}
              onPick={onPick}
              onBox={onBox}
              names={vload?.state === "ready" ? new Map(Object.entries(vload.names)) : nameMap}
              onTools={setTools}
              menu={menu}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-muted">
              {vt ? (vload?.state === "error" ? vload.error : vload?.state === "missing" ? "This version isn't kept yet: open it once on the CAD page to build it." : "Loading the version…") : !builtAt[kind] ? "No 3D model yet. Open the CAD page to build it." : model === null ? "The 3D model couldn't load." : "Loading the 3D model…"}
            </div>
          )}
        </div>
        {/* Each picked part below the view (Harel, 2026-11-21): picture, name, system, the version
            it would go in at, × to drop it; Insert sits with the list. */}
        <div className="rounded-lg border border-border bg-surface">
          <div className="flex items-center gap-2 p-1.5">
            <span className="flex-1 pl-1 text-xs text-muted tabular-nums">{chosen.length ? `${chosen.length} part${chosen.length === 1 ? "" : "s"} picked` : "Click parts to pick them (click again to drop one), or drag a box; Esc clears."}</span>
            {chosen.length > 0 && (
              <>
                <button type="button" className="btn min-h-9 px-2 text-xs active:scale-[0.98]" onClick={() => setChosen([])}>
                  Clear
                </button>
                <button type="button" className="btn btn-primary min-h-9 active:scale-[0.98] disabled:cursor-wait" disabled={busy || readOnly} onClick={() => void insert(chosen)}>
                  {busy ? "Inserting…" : "Insert"}
                </button>
              </>
            )}
          </div>
          {chosen.length > 0 && (
            <ul className="max-h-56 divide-y divide-border overflow-y-auto border-t border-border">
              {chosen.map((k) => {
                const sid = systemOf.get(k);
                const v = sid ? versionLabel(sid) : null;
                const name = (vload?.state === "ready" ? vload.names[k] : undefined) ?? info[k]?.name ?? k.split(":")[2] ?? k;
                const thumb = info[k]?.thumb;
                return (
                  <li key={k} className="flex items-center gap-2 px-1.5 py-1">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-8 w-8 shrink-0 rounded bg-white object-contain" loading="lazy" />
                    ) : (
                      <span className="h-8 w-8 shrink-0 rounded bg-raised" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-fg">{name}</span>
                      <span className={`block truncate text-[0.6875rem] ${v?.ok === false ? "text-amber-500" : "text-muted"}`}>
                        {sid ? sysName(sid) : "No system"}
                        {v ? ` · ${v.text}` : ""}
                      </span>
                    </span>
                    <button type="button" className="press flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted hover:bg-raised hover:text-fg active:scale-[0.98] pointer-coarse:h-9 pointer-coarse:w-9" onClick={() => setChosen((c) => c.filter((x) => x !== k))} aria-label={`Drop ${name}`}>
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {readOnly && <p className="text-xs text-amber-500">This tab is a version: open the workspace to insert.</p>}
        {result && (
          <div className={`rounded-lg border p-2 text-xs ${result.ok ? "border-emerald-500/40 bg-emerald-500/10 text-fg" : "border-red-500/40 bg-red-500/10 text-fg"}`} role="status">
            <p>{result.text}</p>
            {result.skipped?.length ? (
              <ul className="mt-1 list-disc pl-4 text-muted">
                {result.skipped.map((s) => (
                  <li key={s}>Skipped {s}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
        {sys && (
          <VersionTree tree={tree} comments={NO_COMMENTS} onFocus={() => {}} empty="No versions yet." owner={{ systemId: sys.id }} current={current} />
        )}
      </div>
    </VersionContext.Provider>
  );
}
