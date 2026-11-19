"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MAP_H, MAP_W, WORKSHOP_ROOMS } from "@/config/workshopMap";
import { useStoredChoice } from "@/components/ui/useStoredChoice";
import { bounds, centroid, kindLabel, placeIndex, pointInPolygon, spotRect, spotsOf, zoneColor, type Place } from "@/lib/inventory/places";
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
// plays it back. In the picture every drawer and shelf is a rectangle showing its main category. `find` flies from the whole map
// to a place in about 2.5 seconds. "pick" mode chooses a zone or a drawer instead of filtering.

export type PlaceStat = {
  count: number;
  short: number;
  categories: { id: string; label: string; imageUrl: string | null; count: number }[];
  items: { id: string; name: string }[];
  // The picture of the category most of its items are (null when none has one).
  picture?: string | null;
};
export type PlaceStats = Map<string, PlaceStat>;

type Sel = { id: string; kind: "zone" | "spot" } | null;

// One tint for the whole map (Harel, 2026-11-14): the site's Orbit accent mixed into dark navy,
// read from the theme, so the colour slider turns the map too.
const ACCENT = "var(--color-accent)";
const tint = (pct: number, base: string) => `color-mix(in oklab, var(--color-accent) ${pct}%, ${base})`;
// The ground follows the greyscale slider (Harel, 2026-11-19): the page's own --color-ink (white
// to near-black with the slider), with the paved yard a step toward --color-line. At the dark end
// these land on the old fixed navy; the buildings stay dark blocks, so their labels and the zones
// on them read the same at both ends.
const INK = "var(--color-ink)";
const ground = (linePct: number) => `color-mix(in oklab, var(--color-line) ${linePct}%, ${INK})`;
const BG = tint(3, INK);

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
  onTapEmpty,
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
  // Extra buttons in the top-left corner.
  toolbar?: React.ReactNode;
  // A tap on the floor away from any zone (the docked map opens its window, like BOM 3D previews).
  onTapEmpty?: () => void;
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
  // How solid the drawer tags are in a zone's picture: 1 shows the category picture, 0 only the
  // outline over the real drawer (Harel, 2026-11-17). Kept on this device.
  const [tagStep, setTagStep] = useStoredChoice("shopMap.tagOpacity", TAG_STEPS, "1");
  const tagOpacity = Number(tagStep);
  const setTagOpacity = (v: number) => setTagStep(String(Math.round(v * 20) / 20) as (typeof TAG_STEPS)[number]);

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
  // The camera move takes most of the dive; the picture fades in over its end.
  const tilt = smooth(smoothstep(0, 0.8, cam.dive));
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
    else if (onTapEmpty) onTapEmpty();
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
  // How far each zone's category pictures have faded in (the same rule as where they're drawn).
  const picturesShown = (z: Place) => {
    const b = bounds(z.outline!);
    return smoothstep(14, 34, Math.min(b.w, b.h) / k) * smoothstep(36, 76, Math.max(b.w, b.h) / k);
  };
  const pictured = drawn.filter((z) => stats?.get(z.id)?.categories.length).map((z) => ({ outline: z.outline!, show: picturesShown(z) }));

  return (
    <div
      ref={boxRef}
      className={`stage-frame relative touch-none overflow-hidden select-none ${onTapEmpty ? "stage-glow cursor-pointer" : ""} ${className}`}
      style={{ background: BG }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="application"
      aria-label="Shop map"
    >
      {/* The 3D layers, clipped to the rounded frame (overflow alone lets tilted layers poke out at
          the corners) inside it, so the frame's hover glow stays outside the clip. */}
      <div className="absolute inset-0" style={{ perspective: "1100px", clipPath: "inset(0 round 0.875rem)" }}>
      {/* The floor plan: tilts back and fades as the picture stands up. */}
      <div
        className="absolute inset-0"
        style={{
          transformOrigin: "50% 55%",
          // The camera lowers toward the floor until it looks almost along it, moving forward as it
          // goes; the picture then fades in over it (Harel, 2026-11-17: no folding image).
          transform: cam.dive > 0 ? `translateY(${tilt * 18}%) rotateX(${tilt * 78}deg) scale(${1 + tilt * 1.1})` : undefined,
          opacity: 1 - smoothstep(0.72, 1, cam.dive),
          visibility: inScene ? "hidden" : undefined,
        }}
      >
        <svg viewBox={`${plan.x} ${plan.y} ${plan.w} ${plan.w * aspect}`} className="block h-full w-full" aria-hidden>
          <defs>
            <radialGradient id="sm-ground" cx="50%" cy="42%" r="70%">
              <stop offset="0%" style={{ stopColor: tint(7, ground(25)) }} />
              <stop offset="100%" style={{ stopColor: BG }} />
            </radialGradient>
            <linearGradient id="sm-roof" x1="0" y1="0" x2="0.3" y2="1">
              <stop offset="0%" style={{ stopColor: tint(12, "#2b3242") }} />
              <stop offset="100%" style={{ stopColor: tint(9, "#1a1f2b") }} />
            </linearGradient>
            <linearGradient id="sm-roof-out" x1="0" y1="0" x2="0.3" y2="1">
              <stop offset="0%" style={{ stopColor: tint(9, "#252b38") }} />
              <stop offset="100%" style={{ stopColor: tint(7, "#171b25") }} />
            </linearGradient>
            {/* Fine grain, so the ground and roofs read as surfaces, not flat fills. */}
            <filter id="sm-grain" x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
              <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.07 0" />
            </filter>
            <filter id="sm-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
            <filter id="sm-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="9" />
            </filter>
            <filter id="sm-drop" x="-30%" y="-30%" width="160%" height="170%">
              <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" floodColor="#000" floodOpacity="0.55" />
            </filter>
            {/* Category pictures soften at their edges, like decals on the floor. */}
            <radialGradient id="sm-fade-grad" cx="50%" cy="50%" r="50%">
              <stop offset="62%" stopColor="#fff" />
              <stop offset="100%" stopColor="#000" />
            </radialGradient>
            <mask id="sm-fade" maskContentUnits="objectBoundingBox">
              <rect width="1" height="1" fill="url(#sm-fade-grad)" />
            </mask>
            <radialGradient id="sm-pad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" style={{ stopColor: tint(70, "#ffffff"), stopOpacity: 0.32 }} />
              <stop offset="100%" style={{ stopColor: tint(70, "#ffffff"), stopOpacity: 0 }} />
            </radialGradient>
          </defs>
          <g transform={facing ? `rotate(${-facing} ${rx} ${ry})` : undefined}>
            <rect x={-MAP_W} y={-MAP_H} width={MAP_W * 3} height={MAP_H * 3} fill="url(#sm-ground)" />
            <rect x={-MAP_W} y={-MAP_H} width={MAP_W * 3} height={MAP_H * 3} filter="url(#sm-grain)" opacity={0.6} />

            {/* The paved yard around the buildings: each outline drawn wide with round corners, so
                neighbours merge into one rounded lot. */}
            <g pointerEvents="none">
              {WORKSHOP_ROOMS.map((room) => (
                <polygon key={`lot-${room.id}`} points={room.points} strokeLinejoin="round" strokeWidth={40} style={{ fill: tint(5, ground(40)), stroke: tint(5, ground(40)) }} />
              ))}
              {WORKSHOP_ROOMS.map((room) => (
                <polygon key={`lot2-${room.id}`} points={room.points} strokeLinejoin="round" strokeWidth={28} style={{ fill: tint(6, ground(60)), stroke: tint(6, ground(60)) }} />
              ))}
            </g>

            {/* Buildings as rounded blocks: a soft shadow, the wall below, the roof on top. */}
            <g pointerEvents="none">
              {WORKSHOP_ROOMS.map((room) => (
                <polygon key={`sh-${room.id}`} points={room.points} transform="translate(5 9)" fill="#000" opacity={0.5} strokeLinejoin="round" strokeWidth={12} stroke="#000" filter="url(#sm-shadow)" />
              ))}
              {WORKSHOP_ROOMS.map((room) => (
                <polygon key={`wall-${room.id}`} points={room.points} transform="translate(0 4)" strokeLinejoin="round" strokeWidth={12} style={{ fill: tint(6, "#0c0f15"), stroke: tint(6, "#0c0f15") }} />
              ))}
              {WORKSHOP_ROOMS.map((room) => (
                <g key={`roof-${room.id}`}>
                  <polygon points={room.points} strokeLinejoin="round" strokeWidth={12} fill={room.main ? "url(#sm-roof)" : "url(#sm-roof-out)"} stroke={room.main ? "url(#sm-roof)" : "url(#sm-roof-out)"} />
                  <polygon points={room.points} fill="none" strokeLinejoin="round" strokeWidth={1.2} vectorEffect="non-scaling-stroke" style={{ stroke: tint(15, "#ffffff"), strokeOpacity: 0.22 }} />
                </g>
              ))}
            </g>
            <g pointerEvents="none" style={{ direction: "rtl" }}>
              {WORKSHOP_ROOMS.map((room) => (
                <text
                  key={room.id}
                  x={room.labelPos[0]}
                  y={room.labelPos[1]}
                  fontSize={Math.max(room.labelSize * 0.8, 11 * k)}
                  fontWeight={600}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#E8ECF8"
                  // A zone showing its category pictures over the name takes the room's place.
                  fillOpacity={0.62 * (1 - 0.85 * (pictured.find((p) => pointInPolygon(room.labelPos[0], room.labelPos[1], p.outline))?.show ?? 0))}
                  stroke="#070a12"
                  strokeOpacity={0.7 * (1 - 0.85 * (pictured.find((p) => pointInPolygon(room.labelPos[0], room.labelPos[1], p.outline))?.show ?? 0))}
                  strokeWidth={Math.max(2.5, 3 * k)}
                  paintOrder="stroke"
                  strokeLinejoin="round"
                  letterSpacing="0.06em"
                >
                  {room.label}
                </text>
              ))}
            </g>

            {/* A soft light under the lit zone. */}
            {drawn.filter((z) => lit.has(z.id)).map((z) => (
              <polygon key={`glow-${z.id}`} points={z.outline!.map((p) => p.join(",")).join(" ")} strokeLinejoin="round" strokeWidth={10} opacity={0.32} filter="url(#sm-glow)" pointerEvents="none" style={{ fill: ACCENT, stroke: ACCENT }} />
            ))}

            {drawn.map((z) => {
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
                  {/* Rounded lots in the one Orbit tint: a filled pad and a bright rim. */}
                  <polygon points={pts} strokeLinejoin="round" strokeWidth={9} style={{ fill: ACCENT, stroke: ACCENT, fillOpacity: on ? 0.4 : 0.3, strokeOpacity: on ? 0.4 : 0.3 }} />
                  <polygon points={pts} fill="none" strokeLinejoin="round" strokeWidth={on ? 2.6 : 1.5} vectorEffect="non-scaling-stroke" style={{ stroke: tint(45, "#ffffff"), strokeOpacity: on ? 1 : 0.8 }} />
                  {on && (
                    <polygon points={pts} fill="none" strokeLinejoin="round" strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ stroke: tint(40, "#ffffff") }}>
                      <animate attributeName="stroke-opacity" values="0.9;0;0.9" dur="1.8s" repeatCount="indefinite" />
                      <animate attributeName="stroke-width" values="2;9;2" dur="1.8s" repeatCount="indefinite" />
                    </polygon>
                  )}
                </g>
              );
            })}

            {/* Zoomed in, each zone shows the categories stored in it: their pictures lie on the
                floor on a soft pad, growing as you zoom, with a count and (closer) a name. */}
            {drawn.map((z) => {
              const st = stats?.get(z.id);
              if (!st?.categories.length) return null;
              const b = bounds(z.outline!);
              const px = Math.min(b.w, b.h) / k;
              const show = picturesShown(z);
              if (show <= 0.01) return null;
              const n0 = st.categories.length;
              // As big as the zone allows for its categories: 22–120 px on screen.
              const fitTile = Math.sqrt((b.w * b.h * 0.55) / Math.max(n0, 1)) / k;
              const tilePx = clamp(Math.min(fitTile, px * 0.85), 16, 120);
              const tile = tilePx * k;
              const gap = tilePx * 0.12 * k;
              const cols = Math.max(1, Math.floor((b.w * 0.9 + gap) / (tile + gap)));
              const rows = Math.max(1, Math.floor((b.h * 0.9 + gap) / (tile + gap)));
              const room = cols * rows;
              const cats = n0 > room ? st.categories.slice(0, room - 1) : st.categories;
              const extra = n0 - cats.length;
              const n = cats.length + (extra ? 1 : 0);
              const usedCols = Math.min(cols, n);
              const usedRows = Math.ceil(n / cols);
              const [cx, cy] = centroid(z.outline!);
              const x0 = cx - (usedCols * tile + (usedCols - 1) * gap) / 2;
              const y0 = cy - (usedRows * tile + (usedRows - 1) * gap) / 2;
              const at = (i: number) => [x0 + (i % cols) * (tile + gap), y0 + Math.floor(i / cols) * (tile + gap)];
              const badge = clamp(tilePx * 0.22, 9, 18) * k;
              const named = smoothstep(64, 90, tilePx);
              return (
                <g key={`cats-${z.id}`} opacity={show} pointerEvents="none" transform={facing ? `rotate(${facing} ${cx} ${cy})` : undefined}>
                  {cats.map((c, i) => {
                    const [x, y] = at(i);
                    return (
                      <g key={c.id}>
                        <ellipse cx={x + tile / 2} cy={y + tile * 0.62} rx={tile * 0.55} ry={tile * 0.42} fill="url(#sm-pad)" />
                        {c.imageUrl ? (
                          <image href={c.imageUrl} x={x} y={y} width={tile} height={tile} preserveAspectRatio="xMidYMid meet" mask="url(#sm-fade)" filter="url(#sm-drop)" opacity={0.95} />
                        ) : (
                          <text x={x + tile / 2} y={y + tile / 2} fontSize={tile * 0.32} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#E8ECF8" stroke="#070a12" strokeWidth={tile * 0.04} paintOrder="stroke">
                            {c.label.slice(0, 2)}
                          </text>
                        )}
                        {/* Counts once the pictures are big enough to carry them. */}
                        {tilePx >= 30 && <g transform={`translate(${x + tile * 0.86} ${y + tile * 0.16})`}>
                          <rect x={-badge * 0.95} y={-badge / 2} width={badge * 1.9} height={badge} rx={badge / 2} style={{ fill: ACCENT }} stroke="#fff" strokeOpacity={0.85} strokeWidth={badge * 0.08} />
                          <text fontSize={badge * 0.62} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#fff" className="tabular-nums">
                            {c.count > 99 ? "99+" : c.count}
                          </text>
                        </g>}
                        {named > 0.01 && (
                          <text
                            x={x + tile / 2}
                            y={y + tile * 1.02}
                            fontSize={clamp(tilePx * 0.12, 10, 14) * k}
                            fontWeight={600}
                            textAnchor="middle"
                            dominantBaseline="hanging"
                            fill="#F1F4FB"
                            stroke="#070a12"
                            strokeOpacity={0.75}
                            strokeWidth={3 * k}
                            paintOrder="stroke"
                            strokeLinejoin="round"
                            opacity={named}
                          >
                            {c.label}
                          </text>
                        )}
                        <title>{c.label}</title>
                      </g>
                    );
                  })}
                  {extra > 0 &&
                    (() => {
                      // The categories that don't fit share the last tile as a small grid of their
                      // pictures (Harel, 2026-11-16: pictures, not "+2"); past four, the fourth
                      // corner counts the rest.
                      const [x, y] = at(cats.length);
                      const rest = st.categories.slice(cats.length);
                      const shown = rest.length > 4 ? rest.slice(0, 3) : rest;
                      const more = rest.length - shown.length;
                      const rowsN = shown.length + (more ? 1 : 0) <= 2 ? 1 : 2;
                      const cell = tile / 2;
                      const top = y + (tile - cell * rowsN) / 2;
                      return (
                        <g>
                          <ellipse cx={x + tile / 2} cy={y + tile * 0.62} rx={tile * 0.55} ry={tile * 0.42} fill="url(#sm-pad)" />
                          {shown.map((c, j) => {
                            const cx0 = x + (j % 2) * cell;
                            const cy0 = top + Math.floor(j / 2) * cell;
                            return c.imageUrl ? (
                              <image key={c.id} href={c.imageUrl} x={cx0 + cell * 0.04} y={cy0 + cell * 0.04} width={cell * 0.92} height={cell * 0.92} preserveAspectRatio="xMidYMid meet" mask="url(#sm-fade)" filter="url(#sm-drop)" opacity={0.95}>
                                <title>{c.label}</title>
                              </image>
                            ) : (
                              <text key={c.id} x={cx0 + cell / 2} y={cy0 + cell / 2} fontSize={cell * 0.34} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#E8ECF8" stroke="#070a12" strokeWidth={cell * 0.05} paintOrder="stroke">
                                {c.label.slice(0, 2)}
                                <title>{c.label}</title>
                              </text>
                            );
                          })}
                          {more > 0 && (
                            <text x={x + cell * 1.5} y={top + cell * 1.5} fontSize={cell * 0.36} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#F8FAFC" stroke="#070a12" strokeWidth={cell * 0.05} paintOrder="stroke">
                              +{more}
                            </text>
                          )}
                        </g>
                      );
                    })()}
                  {st.short > 0 && (
                    <circle cx={x0} cy={y0} r={4 * k} fill="#F43F5E" stroke="#fff" strokeWidth={1 * k}>
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
            transform: inScene ? undefined : `scale(${lerp(1.04, 1, smoothstep(0.6, 1, cam.dive))})`,
            opacity: smoothstep(0.6, 0.97, cam.dive),
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
            <img src={zone.imageUrl} alt="The zone from where you'd stand" className="h-full w-full rounded-2xl" draggable={false} />
            {/* The found (or picked) drawer in a spotlight: the rest of the picture dims. */}
            {(() => {
              const lit = byId.get(flash ?? (sel?.kind === "spot" ? sel.id : "") ?? "");
              if (!lit || lit.parentId !== zone.id || lit.spotX == null || lit.spotY == null) return null;
              const r = spotRect(lit, zone);
              const reach = Math.max(r.w * dw, r.h * dh) * cam.scene.s * 0.6 + 30;
              return (
                <div
                  key={lit.id}
                  className="pointer-events-none absolute inset-0 animate-[modal-fade_400ms_ease-out]"
                  style={{ background: `radial-gradient(circle at ${r.x * 100}% ${r.y * 100}%, transparent 0, transparent ${reach}px, rgba(2,6,23,0.6) ${reach + 80}px)` }}
                />
              );
            })()}
            {spotsIn(zone.id).map((s) => {
              if (s.spotX == null || s.spotY == null) return null;
              const st = stats?.get(s.id);
              const isFlash = flash === s.id;
              const isSel = selectedId === s.id || (sel?.kind === "spot" && sel.id === s.id);
              const on = isFlash || isSel;
              const color = zoneColor(zone);
              // The tag is a rectangle over the drawer, sized as a share of the picture, so it grows
              // and shrinks with the zoom (Harel, 2026-11-17). Its tap target never drops below 36 px.
              const r = spotRect(s, zone);
              const rw = r.w * dw * cam.scene.s;
              const rh = r.h * dh * cam.scene.s;
              // The drawer a find flight lands on turns see-through, so the real drawer shows inside
              // its outline (Harel, 2026-11-17); back to the slider's look on the next touch.
              const solid = isFlash ? 0 : tagOpacity;
              return (
                <button
                  key={s.id}
                  type="button"
                  data-spot={s.id}
                  aria-label={`${kindLabel(s.kind)}${st ? `, ${st.count} items` : ""}`}
                  aria-pressed={isSel}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                  style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: Math.max(rw, 36), height: Math.max(rh, 36), opacity: smoothstep(0.8, 1, cam.dive) }}
                  onClick={(ev) => {
                    // Taps arrive through the pointer handlers; this is for keyboards.
                    if (ev.detail === 0) tap({ id: s.id, kind: "spot" });
                  }}
                >
                  <span
                    className={`relative block shrink-0 rounded-[6px] transition-[box-shadow,background-color] duration-500 ${st?.picture ? "" : "bg-white/10 backdrop-blur-[1px]"}`}
                    style={{
                      width: rw,
                      height: rh,
                      background: st?.picture ? `rgba(255,255,255,${solid})` : undefined,
                      // Rings drawn outside the box (shadows, not a border), so the picture fills it all.
                      boxShadow: on
                        ? `0 0 0 2px #fff, 0 0 0 5px ${color}, 0 0 22px 6px rgba(255,255,255,0.6)`
                        : `0 0 0 1.5px ${st?.picture ? color : "rgba(255,255,255,0.7)"}, 0 3px 12px rgba(0,0,0,0.55)`,
                    }}
                  >
                    {st?.picture && (
                      // The category most of the drawer's items are (Harel, 2026-11-17), filling the tag.
                      // eslint-disable-next-line @next/next/no-img-element -- a public picture or a signed link
                      <img src={st.picture} alt="" className="absolute inset-0 h-full w-full rounded-[6px] object-cover transition-opacity duration-500" style={{ opacity: solid }} draggable={false} />
                    )}
                    {on && <span className="absolute -inset-[6px] animate-ping rounded-[10px] border-4" style={{ borderColor: color }} />}
                    {/* The count once the tag is big enough not to be hidden by it (zoom in on a phone). */}
                    {!!st?.count && rw >= 52 && rh >= 30 && (
                      <span
                        className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white px-1 text-[0.625rem] font-bold text-white tabular-nums shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
                        style={{ background: color }}
                      >
                        {st.count > 99 ? "99+" : st.count}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      </div>

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
      <div data-ui className="absolute top-2 left-2 flex flex-col items-start gap-1">
        <div className="flex gap-1">
          {toolbar}
          {cam.dive > 0.5 && (
            <button type="button" className={`${CTRL} w-auto px-2.5 text-xs`} onClick={stepOut}>
              ↩ Floor plan
            </button>
          )}
        </div>
        {inScene && (
          // Fades every drawer tag toward see-through, to look at the drawers behind them.
          <label className="flex h-9 items-center gap-2 rounded-full border border-white/12 bg-[#0b0e18]/75 pr-3 pl-2.5 text-xs font-semibold text-slate-100 shadow-[0_4px_14px_rgba(0,0,0,0.45)] backdrop-blur-md" title="How solid the drawer tags are">
            <span aria-hidden className="relative h-4 w-4 rounded-[4px] border-2 border-slate-100">
              <span className="absolute inset-0 rounded-[2px] bg-slate-100" style={{ opacity: tagOpacity }} />
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={tagOpacity}
              onChange={(e) => setTagOpacity(Number(e.target.value))}
              className="h-9 w-24 cursor-pointer"
              style={{ accentColor: "var(--color-accent)" }}
              aria-label="Drawer tag opacity"
            />
          </label>
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

// The slider's 21 stops, as the stored choice's allowed values.
const TAG_STEPS = Array.from({ length: 21 }, (_, i) => String(i / 20));

// Round, glassy controls like a phone map app.
const CTRL =
  "press flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-[#0b0e18]/75 text-sm font-semibold text-slate-100 shadow-[0_4px_14px_rgba(0,0,0,0.45)] backdrop-blur-md transition-colors duration-150 hover:border-accent hover:text-white active:scale-[0.98]";
const BAR_BTN = "press min-h-9 rounded-full px-3.5 text-xs font-semibold active:scale-[0.98]";

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
        <div data-ui className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-2xl border border-white/10 bg-[#0b0e18]/80 p-2 pl-3 text-xs text-slate-200 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          <span className="flex-1">Tap a drawer or shelf to choose it.</span>
          <button type="button" className={`${BAR_BTN} border border-white/15 bg-white/5 text-slate-100`} onClick={() => onPick?.(zoneInScene.id)}>
            Anywhere in this zone
          </button>
        </div>
      );
    return null;
  }
  const what = sel.kind === "spot" ? kindLabel(place.kind) : "Zone";
  const count = stat?.count ?? 0;
  return (
    <div data-ui className="absolute inset-x-2 bottom-2 animate-[modal-fade_140ms_ease-out] rounded-2xl border border-white/10 bg-[#0b0e18]/80 p-2 pl-3 text-xs text-slate-200 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white">{what}</span>
        <span className="tabular-nums text-slate-400">
          {count} item{count === 1 ? "" : "s"}
          {stat?.short ? <span className="text-rose-400"> · {stat.short} short</span> : null}
        </span>
        <span className="flex-1" />
        {mode === "pick" && (
          <button type="button" className={`${BAR_BTN} bg-accent text-white hover:bg-accent-hover`} onClick={() => onPick?.(place.id)}>
            {sel.kind === "zone" ? "Anywhere in this zone" : `Choose this ${what.toLowerCase()}`}
          </button>
        )}
        {mode === "browse" && onFilter && count > 0 && (
          <button type="button" className={`${BAR_BTN} bg-accent text-white hover:bg-accent-hover`} onClick={() => onFilter(place.id)}>
            Show these items
          </button>
        )}
        {sel.kind === "zone" && hasInside && !inScene && (
          <button type="button" className={`${BAR_BTN} border border-white/15 bg-white/5 text-slate-100`} onClick={onInside}>
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
            <li key={i.id} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[0.6875rem] text-slate-200">
              {i.name}
            </li>
          ))}
          {stat.items.length > 24 && <li className="px-1 text-[0.6875rem] text-slate-400">+{stat.items.length - 24} more</li>}
        </ul>
      )}
    </div>
  );
}
