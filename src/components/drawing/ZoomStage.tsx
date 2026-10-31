"use client";

import { useEffect, useRef, useState } from "react";

const MIN = 0.5;
const MAX = 4;
type View = { z: number; x: number; y: number }; // zoom, then pan in px from the fitted place

// The drawing sheet fitted whole inside its box (no scrollbars), with Ctrl + wheel zoom toward the
// cursor (0.5× to 4×) and drag to pan: middle mouse or Space + drag always, a plain left drag
// when zoomed in and `leftPan` allows it. A drag that pans doesn't count as a click on the sheet.
// A child that handles its own press (a note being dragged) stops the pointerdown from reaching here.
export function ZoomStage({ aspect, leftPan = true, className = "", children }: { aspect: number; leftPan?: boolean; className?: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  const [view, setView] = useState<View>({ z: 1, x: 0, y: 0 });
  const pan = useRef<{ id: number; sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  const space = useRef(false);
  const [grab, setGrab] = useState(false);

  // The biggest sheet that fits the box.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      const w = Math.min(width, height * aspect);
      setFit({ w, h: w / aspect });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  // Ctrl + wheel (and a trackpad pinch, which arrives as one) zooms toward the cursor. Native and
  // not passive, so the page itself doesn't zoom.
  useEffect(() => {
    const el = box.current;
    if (!el || !fit) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // The cursor relative to where the unzoomed sheet sits (centred in the box).
      const cx = e.clientX - r.left - (r.width - fit.w) / 2;
      const cy = e.clientY - r.top - (r.height - fit.h) / 2;
      setView((v) => {
        const z = Math.min(MAX, Math.max(MIN, v.z * Math.exp(-e.deltaY * 0.0025)));
        if (z === v.z) return v;
        const k = z / v.z;
        return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fit]);

  // Space held turns a left drag into a pan.
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e.target)) return;
      e.preventDefault();
      space.current = true;
      setGrab(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      space.current = false;
      setGrab(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const zoomed = view.z !== 1 || view.x !== 0 || view.y !== 0;

  function onPointerDown(e: React.PointerEvent) {
    const left = e.button === 0 && (space.current || (leftPan && view.z > 1));
    if (e.button !== 1 && !left) return;
    if (e.button === 1) e.preventDefault(); // no autoscroll
    pan.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: view.x, y: view.y, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    const [dx, dy] = [e.clientX - p.sx, e.clientY - p.sy];
    if (!p.moved && Math.hypot(dx, dy) < 4) return;
    if (!p.moved) {
      p.moved = true;
      box.current?.setPointerCapture(e.pointerId);
      setGrab(true);
    }
    setView((v) => ({ ...v, x: p.x + dx, y: p.y + dy }));
  }
  function onPointerUp(e: React.PointerEvent) {
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    pan.current = null;
    if (p.moved) swallowClick.current = true;
    setGrab(space.current);
  }

  return (
    <div
      ref={box}
      className={`relative flex items-center justify-center overflow-hidden ${grab ? "cursor-grabbing [&_*]:!cursor-grabbing" : ""} ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onAuxClick={(e) => e.button === 1 && e.preventDefault()}
      onClickCapture={(e) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.stopPropagation();
      }}
    >
      {fit && (
        <div className="shrink-0 origin-top-left" style={{ width: fit.w, height: fit.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          {children}
        </div>
      )}
      {zoomed && (
        <button
          type="button"
          onClick={() => setView({ z: 1, x: 0, y: 0 })}
          className="press absolute bottom-3 right-3 rounded-full border border-white/10 bg-[#0D111A]/90 px-3 py-1 font-mono text-xs tabular-nums text-white shadow-lg backdrop-blur hover:border-sky-400/40 active:scale-[0.98]"
          title="Fit the whole sheet"
        >
          {Math.round(view.z * 100)}% · Reset
        </button>
      )}
    </div>
  );
}
