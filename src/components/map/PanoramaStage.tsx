"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { clampPano, dragPano, project, unproject, wrapDelta, zoomPano, type Box, type Pano, type Pic } from "./panorama";

// The WebGL picture, loaded only where a panorama shows.
export const PanoramaView = dynamic(() => import("./PanoramaCanvas"), { ssr: false });

export type PanoTools = {
  pano: Pano;
  box: Box;
  // A picture point on the screen (px in the stage).
  at: (u: number, v: number) => ReturnType<typeof project>;
  // The picture point under a pointer (client px), u wrapped to 0..1.
  under: (clientX: number, clientY: number) => { u: number; v: number };
};

const ease = (t: number) => 1 - (1 - t) ** 3;

// A panorama you stand in on its own (the PC station window, Harel 2026-11-20): drag to look
// round (it wraps all the way and glides on a little after a flick), pinch or wheel to zoom, and
// Reset view glides back to `start`. What's drawn on it comes from `children`, placed with `at`;
// anything that takes its own pointer stops the pointerdown from reaching the stage.
export function PanoramaStage({
  src,
  pic,
  start,
  className = "",
  onBackground,
  focus,
  children,
  outside,
}: {
  src: string;
  pic: Pic;
  start: (box: Box) => Pano;
  className?: string;
  onBackground?: () => void;
  // Turn to face this picture point whenever its key changes.
  focus?: { u: number; v: number; key: number | string } | null;
  children?: (tools: PanoTools) => React.ReactNode;
  // Drawn over the stage but not clipped by it (a menu by its edge), placed in the same px.
  outside?: (tools: PanoTools) => React.ReactNode;
}) {
  // The stage element as state (not a ref): the tools handed to children read its position.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Box>({ w: 0, h: 0 });
  const [pano, setPanoState] = useState<Pano | null>(null);
  const [failed, setFailed] = useState(false);
  const live = useRef({ pano: null as Pano | null, box });
  const setPano = (p: Pano) => {
    live.current.pano = p;
    setPanoState(p);
  };
  useLayoutEffect(() => {
    if (!node) return;
    const read = () => {
      const b = { w: node.clientWidth, h: node.clientHeight };
      live.current.box = b;
      setBox(b);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  // The opening view, once the stage has its size; kept while the box keeps its size, so moving
  // what's drawn on it doesn't swing the view.
  const [opening, setOpening] = useState<{ key: string; pano: Pano } | null>(null);
  const key = `${box.w}x${box.h}`;
  const fresh = box.w && opening?.key !== key ? { key, pano: start(box) } : null;
  if (fresh) setOpening(fresh);
  const home = (fresh ?? opening)?.pano ?? null;
  const view = pano ?? home;
  useEffect(() => {
    live.current.pano = view;
  });

  const anim = useRef(0);
  const stop = () => cancelAnimationFrame(anim.current);
  useEffect(() => () => cancelAnimationFrame(anim.current), []);
  const glideTo = (to: Pano | null) => {
    stop();
    const from = live.current.pano;
    if (!from || !to) return;
    const du = wrapDelta(to.u - from.u);
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 450);
      const e = ease(k);
      setPano({ u: from.u + du * e, v: from.v + (to.v - from.v) * e, fov: from.fov + (to.fov - from.fov) * e });
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
  const reset = () => glideTo(home);
  const focusKey = focus?.key;
  useEffect(() => {
    const from = live.current.pano;
    if (focusKey == null || !focus || !from) return;
    glideTo(clampPano({ u: focus.u, v: focus.v, fov: from.fov }, pic));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- turns only for a new focus
  }, [focusKey]);

  const local = (clientX: number, clientY: number) => {
    const r = node!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  // Wheel zoom needs a listener that may stop the page scrolling.
  useEffect(() => {
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      const p = live.current.pano;
      if (!p) return;
      e.preventDefault();
      stop();
      const at = local(e.clientX, e.clientY);
      setPano(zoomPano(p, pic, live.current.box, Math.exp(-e.deltaY * 0.0015), at.x, at.y));
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  });

  // One finger looks round, two pinch. A flick keeps turning a little (u and v per ms).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const fling = useRef({ vu: 0, vv: 0, t: 0 });
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    stop();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
    fling.current = { vu: 0, vv: 0, t: performance.now() };
    onBackground?.();
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const ps = pointers.current;
    const last = ps.get(e.pointerId);
    const p = live.current.pano;
    if (!last || !p) return;
    const now = local(e.clientX, e.clientY);
    ps.set(e.pointerId, now);
    const b = live.current.box;
    if (ps.size === 1) {
      const next = dragPano(p, pic, b, last, now);
      const t = performance.now();
      const dt = Math.max(t - fling.current.t, 1);
      // A running average of the turn speed, for the glide after a flick.
      const k = Math.min(1, dt / 60);
      fling.current = { vu: fling.current.vu * (1 - k) + ((next.u - p.u) / dt) * k, vv: fling.current.vv * (1 - k) + ((next.v - p.v) / dt) * k, t };
      setPano(next);
    } else if (ps.size === 2) {
      const [a, b2] = [...ps.entries()];
      const other = a[0] === e.pointerId ? b2[1] : a[1];
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(now.x - other.x, now.y - other.y);
      const midA = { x: (last.x + other.x) / 2, y: (last.y + other.y) / 2 };
      const midB = { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 };
      let next = dragPano(p, pic, b, midA, midB);
      if (before > 0 && after > 0) next = zoomPano(next, pic, b, after / before, midB.x, midB.y);
      fling.current = { vu: 0, vv: 0, t: performance.now() };
      setPano(next);
    }
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const ps = pointers.current;
    if (!ps.delete(e.pointerId) || ps.size) return;
    const f = fling.current;
    if (performance.now() - f.t > 80 || Math.hypot(f.vu * 360, f.vv * 100) < 0.02) return;
    let { vu, vv } = f;
    let t0 = performance.now();
    const glide = (t: number) => {
      const dt = t - t0;
      t0 = t;
      const p = live.current.pano;
      if (!p) return;
      const decay = Math.exp(-dt / 260);
      setPano(clampPano({ ...p, u: p.u + vu * dt, v: p.v + vv * dt }, pic));
      vu *= decay;
      vv *= decay;
      if (Math.abs(vu) * 360 > 0.002 || Math.abs(vv) > 1e-5) anim.current = requestAnimationFrame(glide);
    };
    anim.current = requestAnimationFrame(glide);
  };

  const tools: PanoTools | null = view
    ? {
        pano: view,
        box,
        at: (u, v) => project(view, pic, box, u, v),
        under: (clientX, clientY) => {
          const p = local(clientX, clientY);
          const q = unproject(view, pic, box, p.x, p.y);
          return { u: q.u - Math.floor(q.u), v: Math.min(1, Math.max(0, q.v)) };
        },
      }
    : null;

  return (
    <div className="relative">
    <div
      ref={setNode}
      className={`relative touch-none overflow-hidden bg-[#0D111A] select-none ${className}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="application"
      aria-label="360° view: drag to look around, pinch to zoom"
    >
      {view && !failed && <PanoramaView src={src} pic={pic} pano={view} box={box} onError={() => setFailed(true)} />}
      {failed && <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-slate-300">The 360° picture couldn&apos;t load.</p>}
      {tools && children?.(tools)}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={reset}
        className="press absolute right-2 bottom-2 z-[2] flex min-h-9 items-center gap-1.5 rounded-full border border-white/30 bg-[#0D111A]/80 px-3 text-xs font-semibold text-white backdrop-blur-md active:scale-[0.98]"
      >
        <Icon name="undo" className="h-3.5 w-3.5" /> Reset view
      </button>
    </div>
    {tools && outside?.(tools)}
    </div>
  );
}
