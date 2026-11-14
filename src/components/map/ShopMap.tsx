"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MAP_H, MAP_W, WORKSHOP_ROOMS } from "@/config/workshopMap";
import { bounds, centroid, kindLabel, placeIndex, pointInPolygon, spotsOf, zoneColor, type Place } from "@/lib/inventory/places";
import {
  DIVE_SPAN,
  FIND_MS,
  FULL_SCENE,
  SCENE_MAX,
  centeredPlan,
  clamp,
  clampPlan,
  clampScene,
  easeInOut,
  findCam,
  fullPlan,
  homeCam,
  lerp,
  planCenter,
  smooth,
  smoothstep,
  zoneFit,
  type Cam,
  type Plan,
} from "./camera";

// The shop map (Harel, 2026-11-14). Zoomed out: the floor plan with each zone's outline. Closer:
// the categories stored in each zone appear inside it as their pictures. Closer still the floor
// plan tilts away and the zone's first-person picture stands up in front (the dive); zooming out
// plays it back. In the picture every drawer and shelf is a dot. `find` flies from the whole map
// to a place in 2 seconds. "pick" mode chooses a zone or a drawer instead of filtering.

export type PlaceStat = {
  count: number;
  short: number;
  categories: { id: string; label: string; imageUrl: string | null; count: number }[];
  items: { id: string; name: string }[];
};
export type PlaceStats = Map<string, PlaceStat>;

type Sel = { id: string; kind: "zone" | "spot" } | null;

const BG = "#070B14";
// Rooms are tinted apart, quietly, so the bright zones stand out on top of them.
const ROOM_TINTS = ["#1E3A5F", "#3B2F5C", "#1F4B43", "#4A3524", "#2E3F63", "#3F2A44", "#26443A", "#4A2F35", "#2A3A52", "#3D3B24"];

function useBoxSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 450 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 450 });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ShopMap({
  places,
  stats,
  mode = "browse",
  selectedId,
  find,
  findKey = 0,
  onPick,
  onFilter,
  className = "aspect-[16/10] w-full",
  toolbar,
}: {
  places: Place[];
  stats?: PlaceStats;
  mode?: "browse" | "pick";
  // The place that's lit (the filter, or the picker's current value).
  selectedId?: string | null;
  // Fly to this place when it (or findKey) changes.
  find?: string | null;
  findKey?: number;
  onPick?: (id: string | null) => void;
  // Browse: "Show these items" on a zone or a drawer.
  onFilter?: (id: string) => void;
  className?: string;
  // Extra buttons in the top-left corner (expand, close).
  toolbar?: React.ReactNode;
}) {
  const { ref: boxRef, w: boxW, h: boxH } = useBoxSize();
  const box = { w: boxW, h: boxH };
  const aspect = boxH / Math.max(boxW, 1);
  const byId = useMemo(() => placeIndex(places), [places]);
  const zones = useMemo(() => places.filter((p) => !p.parentId), [places]);
  const drawn = useMemo(() => zones.filter((z) => (z.outline?.length ?? 0) >= 3), [zones]);

  const [cam, setCamState] = useState<Cam>(() => homeCam(9 / 16));
  const camRef = useRef(cam);
  const setCam = useCallback((c: Cam) => {
    camRef.current = c;
    setCamState(c);
  }, []);
  const [sel, setSel] = useState<Sel>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Animations: one frame function at a time; any touch stops it.
  const anim = useRef(0);
  const stop = () => cancelAnimationFrame(anim.current);
  const play = useCallback((ms: number, frame: (t: number) => Cam, done?: () => void) => {
    cancelAnimationFrame(anim.current);
    if (reducedMotion() || ms <= 0) {
      anim.current = requestAnimationFrame(() => {
        setCam(frame(ms));
        done?.();
      });
      return;
    }
    let start = -1;
    const tick = (now: number) => {
      if (start < 0) start = now;
      const t = Math.min(ms, now - start);
      setCam(frame(t));
      if (t < ms) anim.current = requestAnimationFrame(tick);
      else done?.();
    };
    anim.current = requestAnimationFrame(tick);
  }, [setCam]);
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  // From where the camera is to another camera state, in `ms`.
  const glideTo = useCallback(
    (to: Cam, ms = 450, done?: () => void) => {
      const from = camRef.current;
      const [fx, fy] = planCenter(from.plan, aspect);
      const [tx, ty] = planCenter(to.plan, aspect);
      play(
        ms,
        (t) => {
          const e = easeInOut(t / ms);
          const w = Math.exp(lerp(Math.log(from.plan.w), Math.log(to.plan.w), e));
          return {
            plan: centeredPlan(lerp(fx, tx, e), lerp(fy, ty, e), w, aspect),
            zone: e < 1 && to.dive === 0 && from.dive > 0 ? from.zone : (to.zone ?? from.zone),
            dive: lerp(from.dive, to.dive, e),
            scene: {
              s: lerp(from.scene.s, to.scene.s, e),
              cx: lerp(from.scene.cx, to.scene.cx, e),
              cy: lerp(from.scene.cy, to.scene.cy, e),
            },
          };
        },
        done,
      );
    },
    [aspect, play],
  );

  // The flight to `find`, once the box has its real size.
  const sized = boxW !== 800 || boxH !== 450;
  useEffect(() => {
    if (!sized) return;
    const target = find ? byId.get(find) : undefined;
    const zone = target ? (target.parentId ? byId.get(target.parentId) : target) : undefined;
    if (!target || !zone?.outline?.length) {
      anim.current = requestAnimationFrame(() => setCam(homeCam(aspect)));
      return;
    }
    const spot = target.parentId ? target : null;
    play(FIND_MS, (t) => findCam(t, zone, spot, aspect), () => {
      setFlash(target.id);
      setSel({ id: target.id, kind: spot ? "spot" : "zone" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- replays only for a new target
  }, [find, findKey, sized]);
  // A new box shape keeps the view's centre and width.
  const lastAspect = useRef(aspect);
  useEffect(() => {
    if (lastAspect.current === aspect) return;
    const c = camRef.current;
    const [cx, cy] = planCenter(c.plan, lastAspect.current);
    lastAspect.current = aspect;
    setCam({ ...c, plan: clampPlan(centeredPlan(cx, cy, c.plan.w, aspect), aspect) });
  }, [aspect, setCam]);

  const zone = cam.zone ? byId.get(cam.zone) : undefined;
  const fit = zone ? zoneFit(zone, aspect) : null;
  // While diving, the floor plan settles on the zone and turns so the picture's direction is up.
  const settle = smoothstep(0, 0.35, cam.dive);
  const plan: Plan = fit && cam.dive > 0
    ? (() => {
        const [ax, ay] = planCenter(cam.plan, aspect);
        const [bx, by] = planCenter(fit, aspect);
        return centeredPlan(lerp(ax, bx, settle), lerp(ay, by, settle), Math.exp(lerp(Math.log(cam.plan.w), Math.log(fit.w), settle)), aspect);
      })()
    : cam.plan;
  const e = smooth(cam.dive);
  const inScene = cam.dive >= 0.999 && !!zone?.imageUrl;
  const k = plan.w / Math.max(box.w, 1); // map units per screen pixel

  // ---------- Input ----------

  const toMap = (clientX: number, clientY: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: plan.x + ((clientX - r.left) / r.width) * plan.w, y: plan.y + ((clientY - r.top) / r.height) * plan.w * aspect };
  };
  const zoneAt = (x: number, y: number) => [...drawn].reverse().find((z) => pointInPolygon(x, y, z.outline!));

  // The picture's drawn rectangle (contained in the box) at zoom 1.
  const img = zone?.imageW && zone.imageH ? { w: zone.imageW, h: zone.imageH } : { w: 16, h: 10 };
  const fitScale = Math.min(box.w / img.w, box.h / img.h);
  const dw = img.w * fitScale;
  const dh = img.h * fitScale;

  const zoomBy = (factor: number, clientX: number, clientY: number) => {
    stop();
    setFlash(null);
    const c = camRef.current;
    const r = boxRef.current!.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    if (c.dive >= 0.999 && c.zone) {
      const s = c.scene.s * factor;
      if (factor < 1 && c.scene.s <= 1.0001) {
        // Zooming out of the whole picture walks back out to the floor plan.
        setCam({ ...c, dive: clamp(c.dive + Math.log(factor) / Math.log(DIVE_SPAN), 0, 1), scene: FULL_SCENE });
        return;
      }
      const u = c.scene.cx + (px - box.w / 2) / (dw * c.scene.s);
      const v = c.scene.cy + (py - box.h / 2) / (dh * c.scene.s);
      const ns = clamp(s, 1, SCENE_MAX);
      setCam({ ...c, scene: clampScene({ s: ns, cx: u - (px - box.w / 2) / (dw * ns), cy: v - (py - box.h / 2) / (dh * ns) }) });
      return;
    }
    if (c.dive > 0 && c.zone) {
      const dive = clamp(c.dive + Math.log(factor) / Math.log(DIVE_SPAN), 0, 1);
      setCam({ ...c, dive, zone: dive > 0 ? c.zone : null });
      return;
    }
    const at = toMap(clientX, clientY);
    const w = c.plan.w / factor;
    // Zooming in on a zone with a picture past its fit starts the dive.
    if (factor > 1) {
      const z = zoneAt(at.x, at.y) ?? (sel?.kind === "zone" ? byId.get(sel.id) : undefined);
      const zf = z?.imageUrl ? zoneFit(z, aspect) : null;
      if (z && zf && w < zf.w) {
        setCam({ ...c, zone: z.id, dive: clamp(Math.log(zf.w / w) / Math.log(DIVE_SPAN), 0.001, 1), scene: FULL_SCENE });
        setSel(null);
        return;
      }
    }
    const nw = clamp(w, 0, fullPlan(aspect).w);
    const ratio = nw / c.plan.w;
    setCam({ ...c, zone: null, dive: 0, plan: clampPlan({ w: nw, x: at.x - (at.x - c.plan.x) * ratio, y: at.y - (at.y - c.plan.y) * ratio }, aspect) });
  };

  // A dive left halfway when the wheel or the fingers stop finishes to the nearer end.
  const settleTimer = useRef(0);
  const settleDive = () => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const c = camRef.current;
      if (c.dive <= 0 || c.dive >= 0.999 || !c.zone || pointers.current.size) return;
      const z = byId.get(c.zone);
      if (c.dive >= 0.5) glideTo({ ...c, dive: 1, scene: FULL_SCENE }, 350);
      else glideTo({ plan: (z && zoneFit(z, aspect)) ?? c.plan, zone: null, dive: 0, scene: FULL_SCENE }, 350);
    }, 220);
  };
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      zoomBy(Math.exp(-ev.deltaY * 0.0016), ev.clientX, ev.clientY);
      settleDive();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ travel: 0, target: null as Sel });
  const onDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    if ((ev.target as Element).closest("[data-ui]")) return;
    stop();
    const t = ev.target as Element;
    const spot = t.closest("[data-spot]")?.getAttribute("data-spot");
    const z = t.closest("[data-zone]")?.getAttribute("data-zone");
    if (pointers.current.size === 0) gesture.current = { travel: 0, target: spot ? { id: spot, kind: "spot" } : z ? { id: z, kind: "zone" } : null };
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  };
  const onMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(ev.pointerId);
    if (!prev) return;
    const g = gesture.current;
    const dx = ev.clientX - prev.x;
    const dy = ev.clientY - prev.y;
    if (pointers.current.size === 1) {
      g.travel += Math.hypot(dx, dy);
      pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (g.travel < 5) return;
      if (!ev.currentTarget.hasPointerCapture(ev.pointerId)) ev.currentTarget.setPointerCapture(ev.pointerId);
      const c = camRef.current;
      if (c.dive >= 0.999) {
        setCam({ ...c, scene: clampScene({ ...c.scene, cx: c.scene.cx - dx / (dw * c.scene.s), cy: c.scene.cy - dy / (dh * c.scene.s) }) });
      } else if (c.dive === 0) {
        const r = boxRef.current!.getBoundingClientRect();
        const s = c.plan.w / r.width;
        setCam({ ...c, plan: clampPlan({ ...c.plan, x: c.plan.x - dx * s, y: c.plan.y - dy * s }, aspect) });
      }
      return;
    }
    const [other] = [...pointers.current.entries()].filter(([id]) => id !== ev.pointerId);
    if (!other) return;
    const o = other[1];
    const before = Math.hypot(prev.x - o.x, prev.y - o.y);
    const after = Math.hypot(ev.clientX - o.x, ev.clientY - o.y);
    g.travel += 10;
    if (!ev.currentTarget.hasPointerCapture(ev.pointerId)) ev.currentTarget.setPointerCapture(ev.pointerId);
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (before > 0) zoomBy(after / before, (ev.clientX + o.x) / 2, (ev.clientY + o.y) / 2);
  };
  const onUp = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(ev.pointerId) || pointers.current.size > 0) return;
    const g = gesture.current;
    if (g.travel >= 5) return settleDive();
    if (g.target) tap(g.target);
    else setSel(null);
  };

  // ---------- Taps and buttons ----------

  const spotsIn = (zoneId: string) => spotsOf(zoneId, places);
  const goToZone = (z: Place) => {
    const zf = zoneFit(z, aspect);
    if (zf) glideTo({ plan: zf, zone: null, dive: 0, scene: FULL_SCENE });
  };
  const stepInside = (z: Place) => {
    const zf = zoneFit(z, aspect);
    if (!zf || !z.imageUrl) return;
    setSel(null);
    const c = camRef.current;
    setCam({ ...c, zone: z.id });
    glideTo({ plan: c.plan, zone: z.id, dive: 1, scene: FULL_SCENE }, 750);
  };
  const stepOut = () => {
    const c = camRef.current;
    const z = c.zone ? byId.get(c.zone) : undefined;
    const zf = z ? zoneFit(z, aspect) : null;
    setSel(z ? { id: z.id, kind: "zone" } : null);
    glideTo({ plan: zf ?? c.plan, zone: null, dive: 0, scene: FULL_SCENE }, 650);
  };
  const tap = (t: NonNullable<Sel>) => {
    setFlash(null);
    const p = byId.get(t.id);
    if (!p) return;
    if (t.kind === "spot") {
      if (mode === "pick") return onPick?.(p.id);
      setSel(t);
      return;
    }
    if (mode === "pick" && !p.imageUrl && !spotsIn(p.id).length) return onPick?.(p.id);
    setSel(t);
    goToZone(p);
  };
  const reset = () => {
    setSel(null);
    glideTo(homeCam(aspect), 500);
  };
  const zoomButton = (f: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    const steps = 12;
    let i = 0;
    const step = () => {
      zoomBy(Math.pow(f, 1 / steps), r.left + r.width / 2, r.top + r.height / 2);
      if (++i < steps) anim.current = requestAnimationFrame(step);
      else settleDive();
    };
    stop();
    anim.current = requestAnimationFrame(step);
  };

  // ---------- Drawing ----------

  const selected = selectedId ? byId.get(selectedId) : undefined;
  const selectedZone = selected ? (selected.parentId ? byId.get(selected.parentId) : selected) : undefined;
  const selPlace = sel ? byId.get(sel.id) : undefined;
  const lit = new Set([selectedZone?.id, sel?.kind === "zone" ? sel.id : undefined, flash && byId.get(flash)?.parentId == null ? flash : undefined].filter(Boolean) as string[]);
  const facing = (zone?.facing ?? 0) * settle;
  const [rx, ry] = zone?.outline ? centroid(zone.outline) : [MAP_W / 2, MAP_H / 2];

  return (
    <div
      ref={boxRef}
      className={`relative touch-none overflow-hidden rounded-xl border border-white/[0.08] select-none ${className}`}
      style={{ background: BG, perspective: "1100px" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="application"
      aria-label="Shop map"
    >
      {/* The floor plan: tilts back and fades as the picture stands up. */}
      <div
        className="absolute inset-0"
        style={{
          transformOrigin: "50% 55%",
          transform: cam.dive > 0 ? `translateY(${e * 12}%) rotateX(${e * 62}deg) scale(${1 + e * 0.55})` : undefined,
          opacity: 1 - smoothstep(0.5, 0.92, cam.dive),
          visibility: inScene ? "hidden" : undefined,
        }}
      >
        <svg viewBox={`${plan.x} ${plan.y} ${plan.w} ${plan.w * aspect}`} className="block h-full w-full" aria-hidden>
          <defs>
            <radialGradient id="sm-floor" cx="50%" cy="45%" r="75%">
              <stop offset="0%" stopColor="#10203A" />
              <stop offset="100%" stopColor={BG} />
            </radialGradient>
            <pattern id="sm-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M20 0H0V20" fill="none" stroke="rgba(56,189,248,0.07)" strokeWidth="0.6" />
            </pattern>
            <pattern id="sm-tiles" width="12" height="12" patternUnits="userSpaceOnUse">
              <path d="M12 0H0V12" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
            </pattern>
            <filter id="sm-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="10" />
            </filter>
            {drawn.map((z) => (
              <clipPath key={z.id} id={`sm-clip-${z.id}`}>
                <polygon points={z.outline!.map((p) => p.join(",")).join(" ")} />
              </clipPath>
            ))}
          </defs>
          <g transform={facing ? `rotate(${-facing} ${rx} ${ry})` : undefined}>
            <rect x={-MAP_W} y={-MAP_H} width={MAP_W * 3} height={MAP_H * 3} fill="url(#sm-floor)" />
            <rect x={-MAP_W} y={-MAP_H} width={MAP_W * 3} height={MAP_H * 3} fill="url(#sm-grid)" />

            {WORKSHOP_ROOMS.map((room, i) => (
              <g key={room.id}>
                <polygon points={room.points} fill={ROOM_TINTS[i % ROOM_TINTS.length]} fillOpacity={room.main ? 0.75 : 0.6} />
                <polygon points={room.points} fill="url(#sm-tiles)" />
                <polygon points={room.points} fill="none" stroke="rgba(226,232,240,0.55)" strokeWidth={2.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                <polygon points={room.points} fill="none" stroke="#0B1220" strokeWidth={0.9} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              </g>
            ))}
            <g pointerEvents="none" fill="#E2E8F0" style={{ direction: "rtl" }}>
              {WORKSHOP_ROOMS.map((room) => (
                <text key={room.id} x={room.labelPos[0]} y={room.labelPos[1]} fontSize={room.labelSize} fontWeight={700} textAnchor="middle" dominantBaseline="middle" opacity={0.28}>
                  {room.label}
                </text>
              ))}
            </g>

            {/* A soft light behind the lit zone. */}
            {drawn.filter((z) => lit.has(z.id)).map((z) => (
              <polygon key={`glow-${z.id}`} points={z.outline!.map((p) => p.join(",")).join(" ")} fill={zoneColor(z)} opacity={0.55} filter="url(#sm-glow)" pointerEvents="none" />
            ))}

            {drawn.map((z, i) => {
              const color = zoneColor(z, i);
              const on = lit.has(z.id);
              const pts = z.outline!.map((p) => p.join(",")).join(" ");
              return (
                <g
                  key={z.id}
                  data-zone={z.id}
                  className="cursor-pointer outline-none"
                  role="button"
                  tabIndex={0}
                  aria-label={`Zone${stats?.get(z.id) ? `, ${stats.get(z.id)!.count} items` : ""}`}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      tap({ id: z.id, kind: "zone" });
                    }
                  }}
                >
                  <polygon points={pts} fill={color} fillOpacity={on ? 0.32 : 0.16} />
                  <polygon
                    points={pts}
                    fill="none"
                    stroke={color}
                    strokeWidth={on ? 3 : 1.8}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                    strokeDasharray={on ? "7 5" : undefined}
                  >
                    {on && <animate attributeName="stroke-dashoffset" values="0;-24" dur="1.2s" repeatCount="indefinite" />}
                  </polygon>
                </g>
              );
            })}

            {/* Zoomed in, each zone shows the categories stored in it. */}
            {drawn.map((z) => {
              const st = stats?.get(z.id);
              if (!st?.categories.length) return null;
              const b = bounds(z.outline!);
              // Tiles fit thin zones too (a shelf along a wall): 18–34 px, by the zone's short side.
              const px = Math.min(b.w, b.h) / k;
              const show = smoothstep(26, 48, px) * smoothstep(60, 100, Math.max(b.w, b.h) / k);
              if (show <= 0.01) return null;
              const tile = clamp(px * 0.72, 18, 34) * k;
              const gap = (tile / k > 24 ? 5 : 3) * k;
              const cols = Math.max(1, Math.floor((b.w * 0.86 + gap) / (tile + gap)));
              const rows = Math.max(1, Math.floor((b.h * 0.86 + gap) / (tile + gap)));
              const room = cols * rows;
              const cats = st.categories.length > room ? st.categories.slice(0, room - 1) : st.categories;
              const extra = st.categories.length - cats.length;
              const n = cats.length + (extra ? 1 : 0);
              const usedCols = Math.min(cols, n);
              const usedRows = Math.ceil(n / cols);
              const [cx, cy] = centroid(z.outline!);
              const x0 = cx - (usedCols * tile + (usedCols - 1) * gap) / 2;
              const y0 = cy - (usedRows * tile + (usedRows - 1) * gap) / 2;
              const at = (i: number) => [x0 + (i % cols) * (tile + gap), y0 + Math.floor(i / cols) * (tile + gap)];
              return (
                <g key={`cats-${z.id}`} opacity={show} pointerEvents="none" transform={facing ? `rotate(${facing} ${cx} ${cy})` : undefined}>
                  {cats.map((c, i) => {
                    const [x, y] = at(i);
                    return (
                      <g key={c.id}>
                        <rect x={x} y={y} width={tile} height={tile} rx={tile * 0.22} fill="rgba(248,250,252,0.94)" stroke={zoneColor(z)} strokeWidth={1.4 * k} />
                        {c.imageUrl ? (
                          <image href={c.imageUrl} x={x + 3 * k} y={y + 3 * k} width={tile - 6 * k} height={tile - 6 * k} preserveAspectRatio="xMidYMid meet" />
                        ) : (
                          <text x={x + tile / 2} y={y + tile / 2} fontSize={13 * k} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#0F172A">
                            {c.label.slice(0, 2)}
                          </text>
                        )}
                        <g transform={`translate(${x + tile} ${y})`}>
                          <rect x={-9 * k} y={-6 * k} width={18 * k} height={12 * k} rx={6 * k} fill="#0F172A" stroke={zoneColor(z)} strokeWidth={0.8 * k} />
                          <text fontSize={8 * k} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#F8FAFC" className="tabular-nums">
                            {c.count > 99 ? "99+" : c.count}
                          </text>
                        </g>
                        <title>{c.label}</title>
                      </g>
                    );
                  })}
                  {extra > 0 && (() => {
                    const [x, y] = at(cats.length);
                    return (
                      <g>
                        <rect x={x} y={y} width={tile} height={tile} rx={7 * k} fill="#0F172A" stroke={zoneColor(z)} strokeWidth={1.4 * k} />
                        <text x={x + tile / 2} y={y + tile / 2} fontSize={11 * k} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#F8FAFC">
                          +{extra}
                        </text>
                      </g>
                    );
                  })()}
                  {st.short > 0 && (
                    <circle cx={x0 - 4 * k} cy={y0 - 4 * k} r={4 * k} fill="#F43F5E" stroke={BG} strokeWidth={1 * k}>
                      <animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" />
                    </circle>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* The zone's first-person picture, standing up from the floor as the dive goes on. */}
      {zone?.imageUrl && cam.dive > 0 && (
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            transformOrigin: "50% 100%",
            transform: inScene ? undefined : `rotateX(${(1 - e) * 82}deg) scale(${lerp(0.6, 1, e)})`,
            opacity: smoothstep(0.04, 0.45, cam.dive),
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a signed R2 link, drawn as is */}
          <img src={zone.imageUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-xl" draggable={false} />
          <div
            className="absolute"
            style={{
              width: dw * cam.scene.s,
              height: dh * cam.scene.s,
              left: box.w / 2 - cam.scene.cx * dw * cam.scene.s,
              top: box.h / 2 - cam.scene.cy * dh * cam.scene.s,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
            <img src={zone.imageUrl} alt="The zone from where you'd stand" className="h-full w-full rounded-sm" draggable={false} />
            {/* The found (or picked) drawer in a spotlight: the rest of the picture dims. */}
            {(() => {
              const lit = byId.get(flash ?? (sel?.kind === "spot" ? sel.id : "") ?? "");
              if (!lit || lit.parentId !== zone.id || lit.spotX == null || lit.spotY == null) return null;
              return (
                <div
                  key={lit.id}
                  className="pointer-events-none absolute inset-0 animate-[modal-fade_400ms_ease-out]"
                  style={{ background: `radial-gradient(circle at ${lit.spotX * 100}% ${lit.spotY * 100}%, transparent 0, transparent 70px, rgba(2,6,23,0.6) 150px)` }}
                />
              );
            })()}
            {spotsIn(zone.id).map((s) => {
              if (s.spotX == null || s.spotY == null) return null;
              const st = stats?.get(s.id);
              const isFlash = flash === s.id;
              const isSel = selectedId === s.id || (sel?.kind === "spot" && sel.id === s.id);
              const color = zoneColor(zone);
              return (
                <button
                  key={s.id}
                  type="button"
                  data-spot={s.id}
                  aria-label={`${kindLabel(s.kind)}${st ? `, ${st.count} items` : ""}`}
                  aria-pressed={isSel}
                  className="absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                  style={{ left: `${s.spotX * 100}%`, top: `${s.spotY * 100}%`, opacity: smoothstep(0.8, 1, cam.dive) }}
                  onClick={(ev) => {
                    // Taps arrive through the pointer handlers; this is for keyboards.
                    if (ev.detail === 0) tap({ id: s.id, kind: "spot" });
                  }}
                >
                  {(isFlash || isSel) && (
                    <>
                      <span className="absolute inset-[-14px] animate-ping rounded-full border-4" style={{ borderColor: color }} />
                      <span className="absolute inset-[-8px] rounded-full border-[3px] border-white shadow-[0_0_18px_4px_rgba(255,255,255,0.7)]" />
                    </>
                  )}
                  <span
                    className={`relative flex items-center justify-center rounded-full border-[3px] font-bold tabular-nums shadow-[0_2px_10px_rgba(0,0,0,0.6)] transition-transform duration-150 ${isFlash || isSel ? "h-8 w-8 scale-110 text-xs text-white" : "h-6 w-6 bg-white text-[0.625rem] text-slate-900"}`}
                    style={{ borderColor: color, background: isFlash || isSel ? color : undefined }}
                  >
                    {st?.count ? (st.count > 99 ? "99+" : st.count) : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Corner buttons */}
      <div data-ui className="absolute top-2 right-2 flex flex-col gap-1">
        <button type="button" className={CTRL} aria-label="Zoom in" onClick={() => zoomButton(1.8)}>
          +
        </button>
        <button type="button" className={CTRL} aria-label="Zoom out" onClick={() => zoomButton(1 / 1.8)}>
          −
        </button>
        <button type="button" className={CTRL} aria-label="Whole map" title="Whole map" onClick={reset}>
          ⟲
        </button>
      </div>
      <div data-ui className="absolute top-2 left-2 flex gap-1">
        {toolbar}
        {cam.dive > 0.5 && (
          <button type="button" className={`${CTRL} w-auto px-2.5 text-xs`} onClick={stepOut}>
            ↩ Floor plan
          </button>
        )}
      </div>

      {/* What's tapped: a zone or a drawer, with what can be done with it. */}
      <Bar
        mode={mode}
        sel={sel}
        place={selPlace}
        stat={sel ? stats?.get(sel.id) : undefined}
        inScene={inScene}
        hasInside={!!selPlace?.imageUrl}
        zoneInScene={inScene ? zone : undefined}
        onPick={onPick}
        onFilter={onFilter}
        onInside={() => selPlace && stepInside(selPlace)}
        onClose={() => setSel(null)}
      />
      {!places.length && (
        <p className="absolute inset-x-0 bottom-3 text-center text-xs text-slate-300">No zones yet. Admins draw them in Settings → Map.</p>
      )}
    </div>
  );
}

const CTRL =
  "press flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-[#0D111A]/85 text-sm font-semibold text-slate-100 backdrop-blur-md transition-colors duration-150 hover:border-sky-400/50 hover:text-sky-300 active:scale-[0.98]";
const BAR_BTN = "press min-h-9 rounded-lg px-3 text-xs font-semibold active:scale-[0.98]";

function Bar({
  mode,
  sel,
  place,
  stat,
  inScene,
  hasInside,
  zoneInScene,
  onPick,
  onFilter,
  onInside,
  onClose,
}: {
  mode: "browse" | "pick";
  sel: Sel;
  place: Place | undefined;
  stat: PlaceStat | undefined;
  inScene: boolean;
  hasInside: boolean;
  zoneInScene: Place | undefined;
  onPick?: (id: string | null) => void;
  onFilter?: (id: string) => void;
  onInside: () => void;
  onClose: () => void;
}) {
  // In the picture in pick mode with nothing tapped: the whole zone is a choice too.
  if (!sel || !place) {
    if (mode === "pick" && inScene && zoneInScene)
      return (
        <div data-ui className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-xl border border-white/10 bg-[#0D111A]/90 p-2 text-xs text-slate-200 backdrop-blur-md">
          <span className="flex-1">Tap a drawer or shelf to choose it.</span>
          <button type="button" className={`${BAR_BTN} border border-white/15 text-slate-100`} onClick={() => onPick?.(zoneInScene.id)}>
            Anywhere in this zone
          </button>
        </div>
      );
    return null;
  }
  const what = sel.kind === "spot" ? kindLabel(place.kind) : "Zone";
  const count = stat?.count ?? 0;
  return (
    <div data-ui className="absolute inset-x-2 bottom-2 animate-[modal-fade_140ms_ease-out] rounded-xl border border-white/10 bg-[#0D111A]/92 p-2 text-xs text-slate-200 shadow-lg backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white">{what}</span>
        <span className="tabular-nums text-slate-400">
          {count} item{count === 1 ? "" : "s"}
          {stat?.short ? <span className="text-rose-400"> · {stat.short} short</span> : null}
        </span>
        <span className="flex-1" />
        {mode === "pick" && (
          <button type="button" className={`${BAR_BTN} bg-sky-600 text-white`} onClick={() => onPick?.(place.id)}>
            {sel.kind === "zone" ? "Anywhere in this zone" : `Choose this ${what.toLowerCase()}`}
          </button>
        )}
        {mode === "browse" && onFilter && count > 0 && (
          <button type="button" className={`${BAR_BTN} bg-sky-600 text-white`} onClick={() => onFilter(place.id)}>
            Show these items
          </button>
        )}
        {sel.kind === "zone" && hasInside && !inScene && (
          <button type="button" className={`${BAR_BTN} border border-white/15 text-slate-100`} onClick={onInside}>
            Look inside →
          </button>
        )}
        <button type="button" className={`${BAR_BTN} text-slate-400`} aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      {sel.kind === "spot" && !!stat?.items.length && (
        <ul className="mt-1.5 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {stat.items.slice(0, 24).map((i) => (
            <li key={i.id} className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[0.6875rem] text-slate-200">
              {i.name}
            </li>
          ))}
          {stat.items.length > 24 && <li className="px-1 text-[0.6875rem] text-slate-400">+{stat.items.length - 24} more</li>}
        </ul>
      )}
    </div>
  );
}
