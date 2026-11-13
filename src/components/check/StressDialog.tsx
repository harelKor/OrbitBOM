"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/Dialog";
import type { Plate } from "@/lib/check/plates";
import { MATERIAL_LIST, solveStress, type Material, type StressResult } from "@/lib/check/stress";

type Role = "held" | "load";

// Phase 6 of the Design check (Harel, 2026-11-13): a plate's stress test. The plate drawn flat;
// a tap on a round hole makes it bolted down (blue), a second tap the hole the load goes in
// (red), a third clears it. Force and direction, then Run: the stress over the plate in colour
// (blue low, red at the material's yield) and the safety factor. In-plane loads only.
export function StressDialog({
  plate,
  name,
  material: initial,
  suggest,
  onClose,
}: {
  plate: Plate;
  name: string;
  material: Material;
  // Phase 7: the AI's guess of the holes and the load (null: not set up or failed).
  suggest?: () => Promise<{ held: number[]; load: { hole: number; N: number; deg: number }; why: string } | null>;
  onClose: () => void;
}) {
  const [roles, setRoles] = useState<Record<number, Role>>({});
  const [force, setForce] = useState("500");
  const [deg, setDeg] = useState(-90);
  const [material, setMaterial] = useState<Material>(initial);
  const [result, setResult] = useState<StressResult | null>(null);
  const [running, setRunning] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  // The drawing fills the window's width (a phone's too), at most 560 px.
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setW(Math.max(200, Math.min(560, el.clientWidth)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const holes = plate.inner.map((l, i) => ({ i, c: l.circle })).filter((h): h is { i: number; c: NonNullable<Plate["inner"][number]["circle"]> } => !!h.c);
  const held = Object.entries(roles).filter(([, r]) => r === "held").map(([i]) => Number(i));
  const load = Object.entries(roles).find(([, r]) => r === "load");
  const box = useMemo(() => {
    const xs = plate.outer.pts.map((p) => p[0]);
    const ys = plate.outer.pts.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }, [plate]);
  const scale = Math.min(W / box.w, 360 / box.h);
  const H = box.h * scale;
  const sx = (x: number) => (x - box.x0) * scale;
  const sy = (y: number) => H - (y - box.y0) * scale; // y up, like the CAD
  const path = (pts: [number, number][]) => pts.map((p, k) => `${k ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("") + "Z";

  const tap = (i: number) => {
    setResult(null);
    setRoles((r) => {
      const next = { ...r };
      if (!r[i]) next[i] = "held";
      else if (r[i] === "held") {
        for (const k of Object.keys(next)) if (next[Number(k)] === "load") delete next[Number(k)];
        next[i] = "load";
      } else delete next[i];
      return next;
    });
  };

  const run = async () => {
    const N = Number(force);
    if (!load || !held.length || !(N > 0)) return;
    setRunning(true);
    const pause = () => new Promise<void>((r) => setTimeout(r, 0));
    const r = await solveStress({ plate, held, load: { hole: Number(load[0]), N, deg }, material }, pause);
    setResult(r);
    setRunning(false);
  };

  // The stress map, under the drawing: each square coloured by its share of the yield stress.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!result) return;
    for (let j = 0; j < result.ny; j++) {
      for (let i = 0; i < result.nx; i++) {
        const v = result.vm[j * result.nx + i];
        if (!Number.isFinite(v)) continue;
        const f = Math.min(1, v / material.yield);
        ctx.fillStyle = `hsl(${Math.round(230 - 230 * Math.sqrt(f))} 85% 50%)`;
        const x = sx(result.x0 + i * result.h);
        const y = sy(result.y0 + (j + 1) * result.h);
        ctx.fillRect(x, y, result.h * scale + 0.6, result.h * scale + 0.6);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sx/sy follow box and scale
  }, [result, material, scale, box]);

  const ask = async () => {
    if (!suggest) return;
    setAsking(true);
    const s = await suggest().catch(() => null);
    setAsking(false);
    if (!s) return setWhy("The AI couldn't suggest loads just now. Pick the holes yourself.");
    const next: Record<number, Role> = {};
    for (const i of s.held) if (holes.some((h) => h.i === i)) next[i] = "held";
    if (holes.some((h) => h.i === s.load.hole)) next[s.load.hole] = "load";
    setRoles(next);
    setForce(String(Math.round(s.load.N)));
    setDeg(Math.round(s.load.deg));
    setWhy(s.why);
    setResult(null);
  };

  const lc = load ? plate.inner[Number(load[0])]?.circle : null;
  const arrow = lc && { x: sx(lc.cx), y: sy(lc.cy), dx: Math.cos((deg * Math.PI) / 180), dy: -Math.sin((deg * Math.PI) / 180) };
  const safe = result ? result.safety : null;

  return (
    <Dialog open onClose={onClose} title={`Stress test · ${name}`} wide sheet>
      <div className="space-y-3 p-4 text-sm">
        <p className="text-xs text-muted">
          Tap round holes: once is bolted down (blue), twice is where the load goes in (red), again clears it. {plate.t.toFixed(1)} mm thick. Loads in the plate&apos;s own plane only: a quick look at where it&apos;s weak, not a certified number.
        </p>
        <div ref={wrap} className="w-full">
        <div className="relative mx-auto overflow-hidden rounded-md border border-line bg-raised" style={{ width: Math.ceil(box.w * scale), height: Math.ceil(H) }}>
          <canvas ref={canvas} width={Math.ceil(box.w * scale)} height={Math.ceil(H)} className="absolute inset-0" />
          <svg width={Math.ceil(box.w * scale)} height={Math.ceil(H)} className="absolute inset-0">
            <path d={path(plate.outer.pts) + plate.inner.map((l) => path(l.pts)).join("")} fillRule="evenodd" fill={result ? "none" : "var(--color-surface)"} stroke="var(--color-fg-2)" strokeWidth={1} />
            {holes.map(({ i, c }) => (
              <circle
                key={i}
                cx={sx(c.cx)}
                cy={sy(c.cy)}
                r={Math.max(6, c.r * scale)}
                className="cursor-pointer"
                fill={roles[i] === "held" ? "rgba(37,99,235,0.6)" : roles[i] === "load" ? "rgba(220,38,38,0.7)" : "rgba(127,127,127,0.15)"}
                stroke={roles[i] ? "white" : "var(--color-fg-2)"}
                strokeWidth={roles[i] ? 2 : 0.8}
                onClick={() => tap(i)}
              >
                <title>{`Ø${(c.r * 2).toFixed(1)} hole`}</title>
              </circle>
            ))}
            {arrow && <line x1={arrow.x} y1={arrow.y} x2={arrow.x + arrow.dx * 40} y2={arrow.y + arrow.dy * 40} stroke="#dc2626" strokeWidth={3} markerEnd="url(#head)" />}
            {result && <circle cx={sx(result.at[0])} cy={sy(result.at[1])} r={7} fill="none" stroke="white" strokeWidth={2} />}
            <defs>
              <marker id="head" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="#dc2626" />
              </marker>
            </defs>
          </svg>
        </div>
        </div>
        {!holes.length && <p className="text-xs text-amber-600">This plate has no round holes to bolt or load.</p>}
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="label">Force</span>
            <span className="flex items-center gap-1.5">
              <input className="input h-9 w-24 tabular-nums" inputMode="decimal" value={force} onChange={(e) => (setForce(e.target.value), setResult(null))} />
              <span className="text-xs text-muted">N</span>
            </span>
          </label>
          <label className="block">
            <span className="label">Pushes</span>
            <select className="input h-9" value={deg} onChange={(e) => (setDeg(Number(e.target.value)), setResult(null))}>
              {[0, 45, 90, 135, 180, -135, -90, -45].map((d) => (
                <option key={d} value={d}>
                  {{ 0: "→ right", 45: "↗", 90: "↑ up", 135: "↖", 180: "← left", [-135]: "↙", [-90]: "↓ down", [-45]: "↘" }[d]}
                </option>
              ))}
              {![0, 45, 90, 135, 180, -135, -90, -45].includes(deg) && <option value={deg}>{deg}°</option>}
            </select>
          </label>
          <label className="block">
            <span className="label">Material</span>
            <select className="input h-9" value={material.name} onChange={(e) => (setMaterial(MATERIAL_LIST.find((m) => m.name === e.target.value) ?? material), setResult(null))}>
              {MATERIAL_LIST.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary h-9 px-3 active:scale-[0.98]" disabled={running || !load || !held.length} onClick={run}>
            {running ? "Working…" : "Run"}
          </button>
          {suggest && (
            <button className="btn h-9 px-3 active:scale-[0.98]" disabled={asking} onClick={ask} title="Ask the AI which holes hold the plate and what pushes on it">
              {asking ? "Asking…" : "Suggest with AI"}
            </button>
          )}
        </div>
        {why && <p className="rounded-md bg-raised px-3 py-2 text-xs text-fg-2">{why}</p>}
        {(!load || !held.length) && <p className="text-xs text-muted">Pick at least one bolted hole and the hole the load goes in.</p>}
        {result && (
          <div className="space-y-1 text-xs">
            <p>
              Highest stress <span className="font-semibold tabular-nums">{result.max.toFixed(0)} MPa</span> (ringed). {material.name} yields at {material.yield} MPa:{" "}
              <span className={`font-semibold tabular-nums ${safe! < 1 ? "text-red-600" : safe! < 2 ? "text-amber-600" : "text-emerald-600"}`}>safety factor {safe! > 99 ? "over 99" : safe!.toFixed(1)}</span>
              {safe! < 1 ? ": it bends for good or breaks." : safe! < 2 ? ": thin for a robot that gets hit; add material round the ring or go thicker." : "."}
            </p>
            <p className="text-muted">
              Moves up to {result.dispMax.toFixed(2)} mm. Grid {result.h.toFixed(1)} mm{result.converged ? "" : " (the solver didn't fully settle: treat the numbers as rough)"}.
            </p>
            <div className="flex items-center gap-2 text-muted">
              <span>0</span>
              <span className="h-2 w-40 rounded" style={{ background: "linear-gradient(to right, hsl(230 85% 50%), hsl(170 85% 50%), hsl(60 85% 50%), hsl(0 85% 50%))" }} />
              <span>yield</span>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
