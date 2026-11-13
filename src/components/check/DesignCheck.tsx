"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { saveCheckLimits, saveDesignCheck, savePartWeight, setFindingIgnored, setOverlapIgnored } from "@/app/(app)/design-check-actions";
import { Dialog } from "@/components/Dialog";
import type { SceneTools, ViewerModel } from "@/components/dashboard/ModelCanvas";
import { LocalTime } from "@/components/ui/LocalTime";
import { toast } from "@/components/ui/Toaster";
import type { CheckData } from "@/lib/check/store";
import { pairKey, type CheckLimits, type CheckResults, type Clash, type DesignFinding, type FindingKind, type WeightPart } from "@/lib/check/types";
import { reweigh } from "@/lib/check/weight";
import { modelSig, runCheck } from "./runCheck";

// What a finding hands the page to show it, or to start a comment about it.
export type Finding = { keys: string[]; body: string; key: string | null; name: string | null; systemId: string | null; pin: [number, number, number] | null };

const kg = (g: number) => (g / 1000).toFixed(2);
const lb = (g: number) => (g / 453.592).toFixed(1);
const inch = (mm: number) => (mm / 25.4).toFixed(1);

// The CAD page's Design check (plan/design-check.md, Harel 2026-11-13): runs in this browser on
// the 3D model already loaded (no Onshape calls), saves what it found for the team, and lists
// weight, frame perimeter and height, and overlapping parts. Each finding shows its parts in the
// 3D view and can become a comment.
export function DesignCheck({
  robotId,
  kind,
  model,
  tools,
  names,
  systemsOf,
  systems,
  onlySystem,
  canCheck,
  canManage,
  onShow,
  onOverlap,
  onMark,
  onComment,
  sandbox,
}: {
  robotId: string;
  kind: "final" | "basepart";
  model: ViewerModel | null | undefined;
  tools: SceneTools | null;
  names: Map<string, string>;
  systemsOf: Map<string, string[]>;
  systems: { id: string; name: string }[];
  onlySystem: string | null;
  canCheck: boolean;
  canManage: boolean;
  onShow: (f: Finding) => void;
  onOverlap: (c: Clash) => void; // Show: the overlap in red, the rest dimmed
  onMark: (f: DesignFinding) => void; // Show on any other finding: its parts, a red dot where
  onComment: (f: Finding) => void;
  sandbox?: CheckData; // /dev/viewer: this data, and nothing saved
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CheckData | null>(sandbox ?? null);
  const [failed, setFailed] = useState(false);
  const [results, setResults] = useState<CheckResults | null>(null);
  const [running, setRunning] = useState<{ step: string; done: number; total: number } | null>(null);
  const [limitsOpen, setLimitsOpen] = useState(false);

  const load = useCallback(() => {
    if (sandbox) return;
    fetch(`/api/robots/${robotId}/design-check?model=${kind}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: CheckData) => {
        setData(d);
        setResults(d.latest?.results ?? null);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [robotId, kind, sandbox]);
  useEffect(() => {
    if (open && !data) load();
  }, [open, data, load]);

  const sig = useMemo(() => (model ? modelSig(model) : null), [model]);
  const stale = !!(data?.latest && sig && data.latest.sig !== sig);
  const ignored = useMemo(() => new Set(data?.ignored ?? []), [data]);
  const sysName = useMemo(() => new Map(systems.map((s) => [s.id, s.name])), [systems]);

  const run = async () => {
    if (!tools || !model || !data || running) return;
    setRunning({ step: "Waiting for the 3D model", done: 0, total: 1 });
    try {
      await tools.whenLoaded();
      const r = await runCheck(tools.checkParts(), { model, names, systemsOf, facts: data.facts, limits: data.limits, ignored }, (step, done, total) => setRunning({ step, done, total }));
      setResults(r);
      const saved = sandbox ? {} : await saveDesignCheck(robotId, kind, modelSig(model), r);
      if (saved.error) toast(saved.error, true);
      else setData({ ...data, latest: { id: "", model: kind, sig: modelSig(model), ranAt: new Date().toISOString(), ranBy: "you", results: r } });
    } catch {
      toast("The design check stopped. Reload the page and run it again.", true);
    } finally {
      setRunning(null);
    }
  };

  // A part's weight set by hand: the totals change at once and the saved run with them.
  const setWeight = async (key: string, grams: number | null) => {
    const r = sandbox ? {} : await savePartWeight(key, grams);
    if (r.error) return toast(r.error, true);
    if (!data) return;
    const facts = { ...data.facts, [key]: { ...(data.facts[key] ?? { material: null, onshapeMaterial: null, printed: false }), setG: grams } };
    setData({ ...data, facts });
    if (results) {
      const next = { ...results, weight: reweigh(results.weight, key, grams, facts[key]) };
      setResults(next);
      if (data.latest && !sandbox) void saveDesignCheck(robotId, kind, data.latest.sig, next);
    }
  };

  const setFindingFine = async (id: string, fine: boolean) => {
    const r = sandbox ? {} : await setFindingIgnored(robotId, id, fine);
    if (r.error) return toast(r.error, true);
    if (!data) return;
    setData({ ...data, ignored: fine ? [...data.ignored, id] : data.ignored.filter((x) => x !== id) });
  };

  const setFine = async (c: Clash, fine: boolean) => {
    const r = sandbox ? {} : await setOverlapIgnored(robotId, c.a, c.b, fine);
    if (r.error) return toast(r.error, true);
    if (!data) return;
    const k = pairKey(c.a, c.b);
    setData({ ...data, ignored: fine ? [...data.ignored, k] : data.ignored.filter((x) => x !== k) });
  };

  const inSystem = (key: string) => !onlySystem || (systemsOf.get(key) ?? []).includes(onlySystem);
  const clashes = (results?.clashes ?? []).filter((c) => !ignored.has(pairKey(c.a, c.b)) && (inSystem(c.a) || inSystem(c.b)));
  const real = clashes.filter((c) => !c.expected);
  const findings = (results?.findings ?? []).filter((f) => !ignored.has(f.id) && (!onlySystem || f.keys.some(inSystem)));
  const findingsFine = (results?.findings ?? []).filter((f) => ignored.has(f.id) && (!onlySystem || f.keys.some(inSystem)));
  const ignoredPairs = (data?.ignored ?? []).filter((k) => k.split("|")[0].includes(":"));
  const usual = clashes.filter((c) => c.expected);
  const weightParts = (results?.weight.parts ?? []).filter((p) => !onlySystem || p.systemId === onlySystem);
  const limits = data?.limits ?? {};
  const totalG = onlySystem ? (results?.weight.bySystem.find((s) => s.systemId === onlySystem)?.g ?? 0) : (results?.weight.totalG ?? 0);
  const limitKg = onlySystem ? (limits.budgets?.[onlySystem] ?? null) : (limits.weightKg ?? null);
  const env = results?.envelope;
  const issues = real.length + findings.filter((f) => f.level === "warn").length + (limitKg && totalG / 1000 > limitKg ? 1 : 0) + (!onlySystem && env && limits.perimeterMm && env.perimeterMm > limits.perimeterMm ? 1 : 0) + (!onlySystem && env && limits.heightMm && env.heightMm > limits.heightMm ? 1 : 0);

  const showClash = (c: Clash) => ({ keys: [c.a, c.b], body: clashText(c), key: c.a, name: c.aName, systemId: pickSystem(systemsOf, c.a, onlySystem), pin: c.at });

  return (
    <section className="rounded-lg border border-line">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="press flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-semibold text-fg hover:bg-raised active:scale-[0.98] pointer-coarse:min-h-11">
        <span className={`text-subtle transition-transform ${open ? "" : "-rotate-90"}`}>▾</span>
        <span className="flex-1">Design check</span>
        {results && <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${issues ? "bg-red-500/15 text-red-600 dark:text-red-400" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"}`}>{issues ? `${issues} to look at` : "OK"}</span>}
      </button>
      {open && (
        <div className="space-y-3 border-t border-line p-3 text-sm">
          {failed && <p className="text-xs text-red-600">The design check couldn&apos;t load. Reload the page.</p>}
          {!failed && !data && <p className="text-xs text-muted">Loading…</p>}
          {data && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {canCheck && (
                  <button className="btn-primary h-9 px-3 active:scale-[0.98] pointer-coarse:min-h-10" disabled={!tools || !model || !!running} onClick={run}>
                    {running ? "Checking…" : results ? "Run again" : "Run the check"}
                  </button>
                )}
                {canManage && (
                  <button className="btn h-9 px-3 active:scale-[0.98] pointer-coarse:min-h-10" onClick={() => setLimitsOpen(true)}>
                    Limits
                  </button>
                )}
              </div>
              {running && (
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted">
                    <span>{running.step}</span>
                    <span className="tabular-nums">{running.total > 1 ? `${Math.round((100 * running.done) / running.total)}%` : ""}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                    <div className="h-full bg-accent transition-[width]" style={{ width: `${running.total ? (100 * running.done) / running.total : 0}%` }} />
                  </div>
                </div>
              )}
              {!results && !running && (
                <p className="text-xs text-muted">
                  {canCheck ? "Weighs the robot, measures its frame perimeter and height, and finds parts that overlap. It runs in this browser on the 3D model (no Onshape calls) and takes a few seconds to a minute." : "Nobody has run the design check on this model yet. The CAD Team runs it from here."}
                </p>
              )}
              {data.latest && !running && (
                <p className="text-xs text-muted">
                  Ran <LocalTime at={data.latest.ranAt} style="ago" />
                  {data.latest.ranBy ? ` by ${data.latest.ranBy}` : ""}
                  {results ? ` · ${(results.ms / 1000).toFixed(1)} s` : ""}
                  {stale && <span className="text-amber-600"> · the 3D model changed since: run it again</span>}
                </p>
              )}

              {results && (
                <>
                  <Weight totalG={totalG} limitKg={limitKg} parts={weightParts} bySystem={onlySystem ? [] : results.weight.bySystem} budgets={limits.budgets ?? {}} sysName={sysName} excluded={(limits.exclude ?? []).map((id) => sysName.get(id) ?? "System")} canSet={canCheck} onSet={setWeight} onShow={(p) => onShow({ keys: [p.key], body: "", key: p.key, name: p.name, systemId: p.systemId, pin: null })} />
                  {!onlySystem && env && (
                    <Block title="Size">
                      <Row label="Frame perimeter" value={`${Math.round(env.perimeterMm)} mm · ${inch(env.perimeterMm)} in`} over={!!limits.perimeterMm && env.perimeterMm > limits.perimeterMm} limit={limits.perimeterMm ? `${limits.perimeterMm} mm` : null} />
                      <Row label="Frame" value={`${Math.round(env.lengthMm)} × ${Math.round(env.widthMm)} mm`} />
                      <Row label="Height" value={`${Math.round(env.heightMm)} mm · ${inch(env.heightMm)} in`} over={!!limits.heightMm && env.heightMm > limits.heightMm} limit={limits.heightMm ? `${limits.heightMm} mm` : null} />
                      {limits.frameZoneMm ? (
                        env.out.length > 0 && (
                          <List title={`Past the frame perimeter (${env.out.length})`}>
                            {env.out.map((o) => (
                              <Item key={o.key} onClick={() => onShow({ keys: [o.key], body: "", key: o.key, name: o.name, systemId: pickSystem(systemsOf, o.key, null), pin: null })} right={`${o.mm} mm`}>
                                {o.name}
                              </Item>
                            ))}
                          </List>
                        )
                      ) : (
                        <p className="text-xs text-muted">The perimeter goes round the whole robot. Set the frame zone in Limits to measure only the frame and list what sticks out past it.</p>
                      )}
                    </Block>
                  )}
                  <Block title={`Overlapping parts (${real.length})`}>
                    {real.length === 0 && <p className="text-xs text-muted">None found{usual.length ? " besides the usual kinds below" : ""}. Overlaps under half a millimetre between round faces aren&apos;t counted: the 3D export is only that accurate.</p>}
                    <ul className="space-y-1">
                      {real.map((c) => (
                        <ClashRow key={pairKey(c.a, c.b)} c={c} canCheck={canCheck} onShow={() => onShow(showClash(c))} onOverlap={() => onOverlap(c)} onComment={() => onComment(showClash(c))} onFine={() => setFine(c, true)} />
                      ))}
                    </ul>
                    {usual.length > 0 && (
                      <List title={`Usually fine: screws, inserts, gears, belts (${usual.length})`}>
                        {usual.map((c) => (
                          <ClashRow key={pairKey(c.a, c.b)} c={c} canCheck={canCheck} onShow={() => onShow(showClash(c))} onOverlap={() => onOverlap(c)} onComment={() => onComment(showClash(c))} onFine={() => setFine(c, true)} />
                        ))}
                      </List>
                    )}
                    {ignoredPairs.length > 0 && (
                      <List title={`Marked fine (${ignoredPairs.length})`}>
                        {ignoredPairs.map((k) => {
                          const [a, b] = k.split("|");
                          return (
                            <li key={k} className="flex items-center gap-2 px-1 py-1 text-xs">
                              <span className="min-w-0 flex-1 truncate text-fg-2">
                                {names.get(a) ?? "A part"} ↔ {names.get(b) ?? "a part"}
                              </span>
                              {canCheck && (
                                <button className="press font-semibold text-accent-hover hover:underline pointer-coarse:min-h-9" onClick={() => setFine({ a, b } as Clash, false)}>
                                  Check again
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </List>
                    )}
                  </Block>
                  {results.findings &&
                    KINDS.map(({ kind, title }) => {
                      const list = findings.filter((f) => f.kind === kind);
                      if (!list.length) return null;
                      return (
                        <Block key={kind} title={`${title} (${list.length})`}>
                          <ul className="space-y-1">
                            {list.slice(0, 60).map((f) => (
                              <FindingRow
                                key={f.id}
                                f={f}
                                canCheck={canCheck}
                                onShow={() => onMark(f)}
                                onComment={() => onComment({ keys: f.keys, body: f.text, key: f.keys[0] ?? null, name: f.names[0] ?? null, systemId: f.keys[0] ? pickSystem(systemsOf, f.keys[0], onlySystem) : null, pin: f.at })}
                                onFine={() => setFindingFine(f.id, true)}
                              />
                            ))}
                          </ul>
                          {list.length > 60 && <p className="text-xs text-muted">And {list.length - 60} more.</p>}
                        </Block>
                      );
                    })}
                  {findingsFine.length > 0 && (
                    <List title={`Other findings marked fine (${findingsFine.length})`}>
                      {findingsFine.map((f) => (
                        <li key={f.id} className="flex items-center gap-2 px-1 py-1 text-xs">
                          <span className="min-w-0 flex-1 truncate text-fg-2" title={f.text}>
                            {f.text}
                          </span>
                          {canCheck && (
                            <button className="press font-semibold text-accent-hover hover:underline pointer-coarse:min-h-9" onClick={() => setFindingFine(f.id, false)}>
                              Check again
                            </button>
                          )}
                        </li>
                      ))}
                    </List>
                  )}
                  {results.findings && !findings.length && <p className="text-xs text-muted">Connections, screws and holes: nothing to look at.</p>}
                </>
              )}
            </>
          )}
        </div>
      )}
      {limitsOpen && data && (
        <LimitsDialog
          limits={data.limits}
          systems={systems}
          onClose={() => setLimitsOpen(false)}
          onSave={async (l) => {
            const r = sandbox ? { limits: l } : await saveCheckLimits(robotId, l);
            if (r.error || !r.limits) return toast(r.error ?? "Couldn't save the limits.", true);
            setData({ ...data, limits: r.limits });
            setLimitsOpen(false);
          }}
        />
      )}
    </section>
  );
}

function pickSystem(systemsOf: Map<string, string[]>, key: string, onlySystem: string | null) {
  const own = systemsOf.get(key) ?? [];
  return onlySystem && own.includes(onlySystem) ? onlySystem : (own[0] ?? null);
}

function clashText(c: Clash) {
  if (c.same) return `${c.aName} is placed twice in the same spot.`;
  const how = c.depthMm >= 0.1 ? ` by about ${c.depthMm.toFixed(1)} mm` : c.flush ? " (they share a face, side by side)" : "";
  return `${c.aName} and ${c.bName} overlap${how}.`;
}

// The sections the other findings are listed in, in this order.
const KINDS: { kind: FindingKind; title: string }[] = [
  { kind: "floating", title: "Not attached" },
  { kind: "hole-offset", title: "Holes that don't line up" },
  { kind: "hole-size", title: "Holes for screws" },
  { kind: "screw-length", title: "Screw length and thread" },
  { kind: "access", title: "Hard to reach" },
  { kind: "one-screw", title: "Held by one screw" },
  { kind: "plate", title: "Plates" },
  { kind: "printed", title: "3D-printed parts" },
];

function FindingRow({ f, canCheck, onShow, onComment, onFine }: { f: DesignFinding; canCheck: boolean; onShow: () => void; onComment: () => void; onFine: () => void }) {
  return (
    <li className={`rounded-md border ${f.level === "warn" ? "border-red-500/40" : "border-line"}`}>
      <button onClick={onShow} className="press w-full px-2.5 py-1.5 text-left text-xs text-fg hover:bg-raised pointer-coarse:min-h-10" title="Show these parts">
        {f.text}
        {f.copies > 1 && <span className="text-muted tabular-nums"> · {f.copies} places</span>}
      </button>
      <div className="flex gap-3 border-t border-line px-2.5 py-1 text-[0.6875rem] font-semibold">
        <button className="press text-red-600 hover:underline pointer-coarse:min-h-9 dark:text-red-400" onClick={onShow} title="Dim everything else and mark the spot in red">
          Show
        </button>
        <button className="press text-accent-hover hover:underline pointer-coarse:min-h-9" onClick={onComment}>
          Comment
        </button>
        {canCheck && (
          <button className="press text-subtle hover:text-fg hover:underline pointer-coarse:min-h-9" onClick={onFine} title="It's meant to be like this: don't list it again">
            It&apos;s fine
          </button>
        )}
      </div>
    </li>
  );
}

function ClashRow({ c, canCheck, onShow, onOverlap, onComment, onFine }: { c: Clash; canCheck: boolean; onShow: () => void; onOverlap: () => void; onComment: () => void; onFine: () => void }) {
  return (
    <li className="rounded-md border border-line">
      <button onClick={onShow} className="press w-full px-2.5 py-1.5 text-left hover:bg-raised pointer-coarse:min-h-10" title="Show these parts">
        <span className="block truncate text-xs font-semibold text-fg">{c.aName}</span>
        <span className="block truncate text-xs text-fg-2">↔ {c.bName}</span>
        <span className="mt-0.5 block text-[0.6875rem] text-muted tabular-nums">
          {c.same ? "placed twice in one spot" : c.depthMm >= 0.1 ? `about ${c.depthMm.toFixed(1)} mm deep` : c.flush ? "share a face side by side" : "overlap"}
          {c.copies > 1 ? ` · ${c.copies} places` : ""}
          {c.expected ? ` · ${c.expected}` : ""}
        </span>
      </button>
      <div className="flex gap-3 border-t border-line px-2.5 py-1 text-[0.6875rem] font-semibold">
        <button className="press text-red-600 hover:underline pointer-coarse:min-h-9 dark:text-red-400" onClick={onOverlap} title="Dim everything else and show where they overlap in red">
          Show
        </button>
        <button className="press text-accent-hover hover:underline pointer-coarse:min-h-9" onClick={onComment}>
          Comment
        </button>
        {canCheck && (
          <button className="press text-subtle hover:text-fg hover:underline pointer-coarse:min-h-9" onClick={onFine} title="It's meant to be like this (a press fit, a thread): don't list it again">
            It&apos;s fine
          </button>
        )}
      </div>
    </li>
  );
}

function Weight({
  totalG,
  limitKg,
  parts,
  bySystem,
  budgets,
  sysName,
  excluded,
  canSet,
  onSet,
  onShow,
}: {
  totalG: number;
  limitKg: number | null;
  parts: WeightPart[];
  bySystem: { systemId: string | null; g: number }[];
  budgets: Record<string, number>;
  sysName: Map<string, string>;
  excluded: string[];
  canSet: boolean;
  onSet: (key: string, grams: number | null) => void;
  onShow: (p: WeightPart) => void;
}) {
  const over = limitKg != null && totalG / 1000 > limitKg;
  const guessed = parts.filter((p) => p.source === "guess");
  return (
    <Block title="Weight">
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular-nums ${over ? "text-red-600 dark:text-red-400" : "text-fg"}`}>{kg(totalG)} kg</span>
        <span className="text-xs text-muted tabular-nums">{lb(totalG)} lb</span>
      </div>
      {limitKg != null && (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-raised">
            <div className={`h-full ${over ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, (totalG / 10 / limitKg))}%` }} />
          </div>
          <p className={`mt-1 text-xs tabular-nums ${over ? "text-red-600 dark:text-red-400" : "text-muted"}`}>
            {over ? `${kg(totalG - limitKg * 1000)} kg over` : `${kg(limitKg * 1000 - totalG)} kg left`} of {limitKg} kg
          </p>
        </div>
      )}
      <p className="text-xs text-muted">
        From each part&apos;s volume and material; printed parts at {Math.round(0.6 * 100)}% solid.{excluded.length ? ` Leaves out ${excluded.join(", ")}.` : ""}
        {guessed.length ? ` ${guessed.length} part${guessed.length > 1 ? "s have" : " has"} no known material and count${guessed.length > 1 ? "" : "s"} as aluminium: set their weight below.` : ""}
      </p>
      {bySystem.length > 1 && (
        <ul className="space-y-0.5">
          {bySystem.map((s) => {
            const budget = s.systemId ? budgets[s.systemId] : undefined;
            const o = budget != null && s.g / 1000 > budget;
            return (
              <li key={s.systemId ?? "none"} className="flex gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-fg-2">{s.systemId ? (sysName.get(s.systemId) ?? "System") : "No system"}</span>
                <span className={`tabular-nums ${o ? "font-semibold text-red-600 dark:text-red-400" : "text-fg"}`}>
                  {kg(s.g)}
                  {budget != null ? ` / ${budget}` : ""} kg
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {guessed.length > 0 && (
        <List title={`Weight unknown (${guessed.length})`} initial>
          {guessed.map((p) => (
            <WeightRow key={`${p.key}|${p.systemId}`} p={p} canSet={canSet} onSet={onSet} onShow={onShow} />
          ))}
        </List>
      )}
      <List title="Heaviest parts">
        {parts.slice(0, 15).map((p) => (
          <WeightRow key={`${p.key}|${p.systemId}`} p={p} canSet={canSet} onSet={onSet} onShow={onShow} />
        ))}
      </List>
    </Block>
  );
}

// One copy's weight; "each" when the row stands for several.
const grams = (p: WeightPart) => `${p.eachG >= 1000 ? `${kg(p.eachG)} kg` : `${Math.round(p.eachG)} g`}${p.count > 1 ? " each" : ""}`;

const SOURCE: Record<WeightPart["source"], string> = { set: "set by hand", material: "from material", printed: "printed, estimate", guess: "guess" };

function WeightRow({ p, canSet, onSet, onShow }: { p: WeightPart; canSet: boolean; onSet: (key: string, grams: number | null) => void; onShow: (p: WeightPart) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  return (
    <li className="px-1 py-1 text-xs">
      <div className="flex items-center gap-2">
        <button onClick={() => onShow(p)} className="press min-w-0 flex-1 truncate text-left text-fg-2 hover:text-fg pointer-coarse:min-h-9" title={p.material ?? undefined}>
          {p.name}
          {p.count > 1 ? <span className="text-muted"> ×{p.count}</span> : null}
        </button>
        {canSet && !editing ? (
          <button
            onClick={() => {
              setText(String(p.eachG));
              setEditing(true);
            }}
            className={`press tabular-nums hover:underline pointer-coarse:min-h-9 ${p.source === "guess" ? "text-amber-600" : "text-fg"}`}
            title={`${SOURCE[p.source]} · tap to set`}
          >
            {grams(p)}
          </button>
        ) : (
          !editing && <span className={`tabular-nums ${p.source === "guess" ? "text-amber-600" : "text-fg"}`} title={SOURCE[p.source]}>{grams(p)}</span>
        )}
      </div>
      {editing && (
        <form
          className="mt-1 flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(text.replace(",", "."));
            if (!(n > 0)) return toast("Type the weight of one in grams.", true);
            onSet(p.key, n);
            setEditing(false);
          }}
        >
          <input className="input h-8 w-24 tabular-nums" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} aria-label="Grams, one copy" autoFocus />
          <span className="text-muted">g each</span>
          <button className="btn-primary h-8 px-2.5">Save</button>
          {p.source === "set" && (
            <button
              type="button"
              className="btn h-8 px-2.5"
              onClick={() => {
                onSet(p.key, null);
                setEditing(false);
              }}
              title="Back to the estimate from its material"
            >
              Clear
            </button>
          )}
          <button type="button" className="press px-1 text-subtle hover:text-fg" onClick={() => setEditing(false)} aria-label="Cancel">
            ✕
          </button>
        </form>
      )}
    </li>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold tracking-wide text-subtle uppercase">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value, over, limit }: { label: string; value: string; over?: boolean; limit?: string | null }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="flex-1 text-fg-2">{label}</span>
      <span className={`tabular-nums ${over ? "font-semibold text-red-600 dark:text-red-400" : "text-fg"}`}>{value}</span>
      {limit && <span className="text-muted tabular-nums">/ {limit}</span>}
    </div>
  );
}

function List({ title, initial = false, children }: { title: string; initial?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="press flex w-full items-center gap-1.5 py-1 text-left text-xs font-semibold text-fg-2 hover:text-fg pointer-coarse:min-h-9">
        <span className={`text-subtle transition-transform ${open ? "" : "-rotate-90"}`}>▾</span>
        {title}
      </button>
      {open && <ul className="space-y-1">{children}</ul>}
    </div>
  );
}

function Item({ onClick, right, children }: { onClick: () => void; right: string; children: React.ReactNode }) {
  return (
    <li>
      <button onClick={onClick} className="press flex w-full items-center gap-2 px-1 py-1 text-left text-xs hover:bg-raised pointer-coarse:min-h-9">
        <span className="min-w-0 flex-1 truncate text-fg-2">{children}</span>
        <span className="text-fg tabular-nums">{right}</span>
      </button>
    </li>
  );
}

function LimitsDialog({ limits, systems, onClose, onSave }: { limits: CheckLimits; systems: { id: string; name: string }[]; onClose: () => void; onSave: (l: CheckLimits) => Promise<void> }) {
  const [f, setF] = useState({
    weightKg: limits.weightKg?.toString() ?? "",
    perimeterMm: limits.perimeterMm?.toString() ?? "",
    heightMm: limits.heightMm?.toString() ?? "",
    frameZoneMm: limits.frameZoneMm?.toString() ?? "",
  });
  const [up, setUp] = useState<NonNullable<CheckLimits["up"]>>(limits.up ?? "z");
  const [exclude, setExclude] = useState(new Set(limits.exclude ?? []));
  const [budgets, setBudgets] = useState<Record<string, string>>(Object.fromEntries(Object.entries(limits.budgets ?? {}).map(([k, v]) => [k, String(v)])));
  const [saving, setSaving] = useState(false);
  const num = (s: string) => (s.trim() ? Number(s.replace(",", ".")) : null);
  const field = (key: keyof typeof f, label: string, unit: string, hint?: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <input className="input h-9 w-32 tabular-nums" inputMode="decimal" value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} placeholder="No limit" />
        <span className="text-xs text-muted">{unit}</span>
      </span>
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
  return (
    <Dialog open onClose={onClose} title="Design check limits" sheet>
      <form
        className="space-y-4 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await onSave({
            weightKg: num(f.weightKg),
            perimeterMm: num(f.perimeterMm),
            heightMm: num(f.heightMm),
            frameZoneMm: num(f.frameZoneMm),
            up,
            exclude: [...exclude],
            budgets: Object.fromEntries(Object.entries(budgets).flatMap(([k, v]) => (num(v) ? [[k, num(v)!]] : []))),
          });
          setSaving(false);
        }}
      >
        <p className="text-xs text-muted">This season&apos;s numbers from the game manual. Empty: the check measures but doesn&apos;t compare.</p>
        {field("weightKg", "Robot weight", "kg", "Without the bumpers and battery, as the rules weigh it.")}
        {field("perimeterMm", "Frame perimeter", "mm")}
        {field("heightMm", "Height", "mm")}
        {field("frameZoneMm", "Frame zone", "mm from the floor", "Only parts this low make the frame perimeter; higher parts reaching past it are listed. Empty: the whole robot.")}
        <label className="block">
          <span className="label">Up in the model</span>
          <select className="input h-9 w-32" value={up} onChange={(e) => setUp(e.target.value as typeof up)}>
            <option value="z">Z (Onshape&apos;s Top)</option>
            <option value="y">Y</option>
            <option value="x">X</option>
          </select>
        </label>
        <div>
          <span className="label">Systems</span>
          <p className="mb-1.5 text-xs text-muted">Tick the ones the weight and size leave out (the bumpers). A budget is that system&apos;s share of the weight.</p>
          <ul className="space-y-1">
            {systems.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <label className="flex min-w-0 flex-1 items-center gap-2 pointer-coarse:min-h-10">
                  <input
                    type="checkbox"
                    checked={exclude.has(s.id)}
                    onChange={(e) => {
                      const next = new Set(exclude);
                      if (e.target.checked) next.add(s.id);
                      else next.delete(s.id);
                      setExclude(next);
                    }}
                  />
                  <span className="truncate">{s.name}</span>
                </label>
                <input className="input h-8 w-20 tabular-nums" inputMode="decimal" placeholder="Budget" value={budgets[s.id] ?? ""} onChange={(e) => setBudgets({ ...budgets, [s.id]: e.target.value })} aria-label={`${s.name} weight budget, kg`} />
                <span className="text-xs text-muted">kg</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn h-9 px-3" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary h-9 px-3" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
