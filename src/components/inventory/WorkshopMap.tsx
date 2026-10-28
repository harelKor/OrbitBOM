"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setLocationSpot } from "@/app/(app)/inventory/actions";
import { MAP_H, MAP_W, WORKSHOP_ROOMS, roomAt, type WorkshopRoom } from "@/config/workshopMap";
import type { Location } from "./types";

// The workshop floor plan (Harel, 2026-10-28): rooms from config/workshopMap.ts, one pin per
// location that has a spot (inventory_locations.map_x / map_y). Drag pans, the wheel and a pinch
// zoom, + / − / ⟲ sit in the corner. Tapping a pin (or a room holding one pin) picks it; a room
// with several pins zooms to them. In Edit mode pins drag to a new spot, saved at once.

export type PinStats = Map<string, { count: number; short: number }>;
type View = { x: number; y: number; w: number };

const ASPECT = MAP_H / MAP_W;
const MIN_W = 160;
const FULL: View = { x: 0, y: 0, w: MAP_W };
const BLUE = "#2563EB";

const clampView = ({ x, y, w }: View): View => {
  const width = Math.min(MAP_W, Math.max(MIN_W, w));
  const h = width * ASPECT;
  return {
    w: width,
    x: Math.min(MAP_W - width / 2, Math.max(-width / 2, x)),
    y: Math.min(MAP_H - h / 2, Math.max(-h / 2, y)),
  };
};
const centeredOn = (cx: number, cy: number, w: number) => clampView({ x: cx - w / 2, y: cy - (w * ASPECT) / 2, w });
const pointsOf = (room: WorkshopRoom) => room.points.split(" ").map((p) => p.split(",").map(Number) as [number, number]);

export function WorkshopMap({
  locations,
  stats,
  selectedId,
  onPick,
  editable = false,
  focusId,
  compact = false,
  hideUnplaced = false,
}: {
  locations: Location[];
  stats?: PinStats;
  selectedId?: string;
  onPick?: (id: string) => void;
  editable?: boolean;
  focusId?: string;
  compact?: boolean;
  hideUnplaced?: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  // Spots dragged here, shown until the page brings the saved ones back.
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const [, startSave] = useTransition();
  const spotOf = (l: Location) =>
    moved[l.id] ?? (l.mapX != null && l.mapY != null ? { x: l.mapX, y: l.mapY } : null);
  const pins = locations.flatMap((l) => {
    const s = spotOf(l);
    return s ? [{ ...l, ...s }] : [];
  });
  const unplaced = locations.filter((l) => !spotOf(l));

  const focusPin = pins.find((p) => p.id === focusId);
  const home = focusPin ? centeredOn(focusPin.x, focusPin.y, 340) : FULL;
  const [view, setViewState] = useState<View>(home);
  const viewRef = useRef(view);
  const setView = (v: View) => {
    viewRef.current = clampView(v);
    setViewState(viewRef.current);
  };

  // + / − / ⟲ and room taps glide; drag, wheel and pinch follow the hand.
  const anim = useRef(0);
  const glide = (to: View) => {
    cancelAnimationFrame(anim.current);
    const from = viewRef.current;
    const target = clampView(to);
    let start = -1;
    const tick = (now: number) => {
      if (start < 0) start = now;
      const t = Math.min(1, (now - start) / 260);
      const e = 1 - Math.pow(1 - t, 3);
      setView({
        x: from.x + (target.x - from.x) * e,
        y: from.y + (target.y - from.y) * e,
        w: from.w + (target.w - from.w) * e,
      });
      if (t < 1) anim.current = requestAnimationFrame(tick);
    };
    anim.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  // Pins and their badges keep about the same size on screen at any zoom.
  const [widthPx, setWidthPx] = useState(800);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidthPx(e.contentRect.width || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const k = (view.w / Math.max(widthPx, 1)) * (widthPx < 520 ? 0.85 : 1);

  const toMap = (clientX: number, clientY: number) => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const zoomAt = (factor: number, at: { x: number; y: number }) => {
    const v = viewRef.current;
    const w = Math.min(MAP_W, Math.max(MIN_W, v.w / factor));
    const r = w / v.w;
    setView({ w, x: at.x - (at.x - v.x) * r, y: at.y - (at.y - v.y) * r });
  };
  const zoomCenter = (factor: number) => {
    const v = viewRef.current;
    const w = v.w / factor;
    glide(centeredOn(v.x + v.w / 2, v.y + (v.w * ASPECT) / 2, w));
  };

  // The wheel zooms around the pointer (a non-passive listener, so the page doesn't scroll too).
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      zoomAt(Math.exp(-e.deltaY * 0.0015), toMap(e.clientX, e.clientY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the view through viewRef
  }, []);

  // Pointers: one drags the map (or, in Edit mode, a pin), two pinch. A press that barely moves
  // is a tap on whatever it started on.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ travel: number; pin: string | null; room: string | null; dragPin: boolean }>({
    travel: 0,
    pin: null,
    room: null,
    dragPin: false,
  });
  const [dragging, setDragging] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    cancelAnimationFrame(anim.current);
    const target = e.target as Element;
    const pin = target.closest("[data-pin]")?.getAttribute("data-pin") ?? null;
    const room = target.closest("[data-room]")?.getAttribute("data-room") ?? null;
    if (pointers.current.size === 0) gesture.current = { travel: 0, pin, room, dragPin: editable && !!pin };
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size > 1) gesture.current.dragPin = false;
  };
  // The pointer is held only once it drags, so a plain hover or tap keeps normal enter / leave.
  const hold = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId);
    setHover(null);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const g = gesture.current;
    if (pointers.current.size === 1) {
      g.travel += Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (g.travel < 4) return;
      hold(e);
      if (g.dragPin && g.pin) {
        const p = toMap(e.clientX, e.clientY);
        setDragging(g.pin);
        setMoved((m) => ({
          ...m,
          [g.pin!]: { x: Math.min(MAP_W, Math.max(0, p.x)), y: Math.min(MAP_H, Math.max(0, p.y)) },
        }));
        return;
      }
      const a = toMap(prev.x, prev.y);
      const b = toMap(e.clientX, e.clientY);
      const v = viewRef.current;
      setView({ ...v, x: v.x - (b.x - a.x), y: v.y - (b.y - a.y) });
      return;
    }
    // Pinch: zoom by the change in finger spread around their midpoint, and follow the midpoint.
    const [other] = [...pointers.current.entries()].filter(([id]) => id !== e.pointerId);
    if (!other) return;
    const o = other[1];
    const before = Math.hypot(prev.x - o.x, prev.y - o.y);
    const after = Math.hypot(e.clientX - o.x, e.clientY - o.y);
    g.travel += 10;
    hold(e);
    const midBefore = toMap((prev.x + o.x) / 2, (prev.y + o.y) / 2);
    const midAfter = toMap((e.clientX + o.x) / 2, (e.clientY + o.y) / 2);
    const v = viewRef.current;
    setView({ ...v, x: v.x - (midAfter.x - midBefore.x), y: v.y - (midAfter.y - midBefore.y) });
    if (before > 0) zoomAt(after / before, midAfter);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(e.pointerId) || pointers.current.size > 0) return;
    const g = gesture.current;
    if (g.dragPin && g.pin && dragging) {
      const id = g.pin;
      const spot = moved[id];
      setDragging(null);
      if (spot)
        startSave(async () => {
          const r = await setLocationSpot(id, spot);
          setError(r.error ?? null);
        });
      return;
    }
    setDragging(null);
    if (g.travel >= 4) return;
    if (g.pin) onPick?.(g.pin);
    else if (g.room) tapRoom(g.room);
  };

  const tapRoom = (roomId: string) => {
    const inRoom = pins.filter((p) => roomAt(p.x, p.y)?.id === roomId);
    if (inRoom.length === 1) return onPick?.(inRoom[0].id);
    const room = WORKSHOP_ROOMS.find((r) => r.id === roomId);
    if (!room) return;
    const pts = pointsOf(room);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const w = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) / ASPECT) * 1.3;
    glide(centeredOn((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, w));
  };

  const place = (id: string) => {
    const v = viewRef.current;
    const spot = { x: Math.round(v.x + v.w / 2), y: Math.round(v.y + (v.w * ASPECT) / 2) };
    setMoved((m) => ({ ...m, [id]: spot }));
    startSave(async () => {
      const r = await setLocationSpot(id, spot);
      setError(r.error ?? null);
    });
  };


  // Lit pins draw last, on top of their neighbours.
  const rank = (id: string) => (id === dragging ? 3 : id === hover ? 2 : id === selectedId || id === focusId ? 1 : 0);
  const tipOf = (id: string) => {
    const pin = pins.find((p) => p.id === id);
    if (!pin) return null;
    const st = stats?.get(id);
    const text =
      dragging === id
        ? "Release to save"
        : st
          ? `${st.count} item${st.count === 1 ? "" : "s"}${st.short ? ` · ${st.short} short` : ""}`
          : (roomAt(pin.x, pin.y)?.label ?? pin.name);
    return { x: pin.x, y: pin.y, text };
  };
  const tipPin = tipOf(dragging ?? hover ?? "");
  const active = pins.find((p) => p.id === (selectedId || focusId));
  const activeRoom = active ? roomAt(active.x, active.y) : null;
  const ctrl =
    "press flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#0D111A]/80 text-sm font-semibold text-slate-200 backdrop-blur-md transition-colors duration-150 hover:border-sky-400/40 hover:text-sky-300 active:scale-[0.98]";

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-[#07090E] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
        <svg
          ref={svg}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.w * ASPECT}`}
          className={`block aspect-[1000/560] w-full touch-none select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label="Workshop map"
        >
          <defs>
            <pattern id="wm-dots" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="10" cy="10" r="0.9" fill="rgba(148,163,184,0.16)" />
            </pattern>
            <pattern id="wm-lines" width="100" height="100" patternUnits="userSpaceOnUse">
              <path d="M100 0H0V100" fill="none" stroke="rgba(56,189,248,0.07)" strokeWidth="1" />
            </pattern>
            <radialGradient id="wm-vignette" cx="50%" cy="45%" r="70%">
              <stop offset="0%" stopColor="#0F1626" />
              <stop offset="100%" stopColor="#07090E" />
            </radialGradient>
            <linearGradient id="wm-main" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1B2536" />
              <stop offset="100%" stopColor="#151D2B" />
            </linearGradient>
            <linearGradient id="wm-out" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#141B28" />
              <stop offset="100%" stopColor="#10161F" />
            </linearGradient>
            <filter id="wm-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="14" />
            </filter>
            <filter id="wm-pin-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={BLUE} floodOpacity="0.9" />
            </filter>
          </defs>

          <rect x={-MAP_W} y={-MAP_H} width={MAP_W * 3} height={MAP_H * 3} fill="url(#wm-vignette)" />
          <rect x={-MAP_W} y={-MAP_H} width={MAP_W * 3} height={MAP_H * 3} fill="url(#wm-dots)" />
          <rect x={-MAP_W} y={-MAP_H} width={MAP_W * 3} height={MAP_H * 3} fill="url(#wm-lines)" />

          {/* Soft light behind the building holding the picked pin. */}
          {activeRoom && (
            <polygon points={activeRoom.points} fill="rgba(56,189,248,0.35)" filter="url(#wm-glow)" pointerEvents="none" />
          )}

          {WORKSHOP_ROOMS.map((room) => {
            // Outer walls 2.5, partitions inside the main complex 1.5; drawn twice for a
            // double architectural line.
            const wall = room.main && room.id !== "circus" ? 1.5 : 2.5;
            const lit = activeRoom?.id === room.id;
            return (
              <g key={room.id} data-room={room.id} className="cursor-pointer">
                <polygon
                  points={room.points}
                  fill={room.main ? "url(#wm-main)" : "url(#wm-out)"}
                  stroke={lit ? "rgba(125,211,252,0.85)" : "rgba(203,213,225,0.5)"}
                  strokeWidth={wall * 1.8}
                  strokeLinejoin="miter"
                  className="transition-[stroke] duration-150"
                />
                <polygon points={room.points} fill="none" stroke="#0B111C" strokeWidth={wall * 0.7} strokeLinejoin="miter" pointerEvents="none" />
                {pointsOf(room).map(([x, y], i) => (
                  <rect key={i} x={x - 1.6} y={y - 1.6} width={3.2} height={3.2} fill="rgba(203,213,225,0.55)" pointerEvents="none" />
                ))}
              </g>
            );
          })}

          {/* Dimmed Hebrew room names: context, not targets. */}
          <g pointerEvents="none" fill="#CBD5E1" style={{ direction: "rtl", letterSpacing: "0.08em" }}>
            {WORKSHOP_ROOMS.flatMap((room) => [
              <text key={room.id} x={room.labelPos[0]} y={room.labelPos[1]} fontSize={room.labelSize} fontWeight={600} textAnchor="middle" dominantBaseline="middle" opacity={0.45}>
                {room.label}
              </text>,
              ...(room.subLabels ?? []).map((s) => (
                <text key={`${room.id}-${s.text}`} x={s.x} y={s.y} fontSize={s.size} textAnchor="middle" dominantBaseline="middle" opacity={0.4}>
                  {s.text}
                </text>
              )),
            ])}
          </g>

          {[...pins].sort((a, b) => rank(a.id) - rank(b.id)).map((p) => {
            const on = p.id === selectedId || p.id === focusId;
            const lit = on || hover === p.id || dragging === p.id;
            const st = stats?.get(p.id);
            const label = p.name.length > 6 ? `${p.name.slice(0, 6)}…` : p.name;
            const bw = Math.max(26, label.length * 7.4 + 12);
            const tip = st ? `${st.count} item${st.count === 1 ? "" : "s"}${st.short ? ` · ${st.short} short` : ""}` : p.name;
            return (
              <g
                key={p.id}
                data-pin={p.id}
                transform={`translate(${p.x} ${p.y}) scale(${k})`}
                className={editable ? "cursor-move" : "cursor-pointer"}
                onPointerEnter={() => setHover(p.id)}
                onPointerLeave={() => setHover((h) => (h === p.id ? null : h))}
                role="button"
                tabIndex={0}
                aria-label={`${p.name}${st ? `, ${tip}` : ""}`}
                aria-pressed={on}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPick?.(p.id);
                  }
                }}
              >
                {on && (
                  // The picked location breathes, so it's found at a glance.
                  <rect x={-bw / 2 - 3} y={-13} width={bw + 6} height={26} rx={10} fill="none" stroke={BLUE} strokeWidth={2} pointerEvents="none">
                    <animate attributeName="opacity" values="0.9;0.15;0.9" dur="1.6s" repeatCount="indefinite" />
                  </rect>
                )}
                <g
                  filter={lit ? "url(#wm-pin-glow)" : undefined}
                  style={{
                    transform: hover === p.id && !dragging ? "scale(1.12)" : "scale(1)",
                    transition: "transform 150ms cubic-bezier(0.22, 1, 0.36, 1)",
                  }}
                >
                  <rect
                    x={-bw / 2}
                    y={-10}
                    width={bw}
                    height={20}
                    rx={7}
                    fill={lit ? BLUE : "rgba(13,17,26,0.94)"}
                    stroke={lit ? "#93C5FD" : "rgba(148,163,184,0.45)"}
                    strokeWidth={1}
                  />
                  <text
                    y={0.5}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={11}
                    fontWeight={700}
                    fill={lit ? "#fff" : "#E2E8F0"}
                    className="font-mono tabular-nums"
                  >
                    {label}
                  </text>
                </g>
                {st && st.short > 0 && (
                  <g transform={`translate(${-bw / 2} -10)`}>
                    <circle r={3.5} fill="#F43F5E">
                      <animate attributeName="r" values="3.5;8;3.5" dur="1.8s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.6;0;0.6" dur="1.8s" repeatCount="indefinite" />
                    </circle>
                    <circle r={3.5} fill="#F43F5E" stroke="#07090E" strokeWidth={1} />
                  </g>
                )}
              </g>
            );
          })}

          {/* The hovered pin's tooltip floats just above it, over every other pin. */}
          {tipPin && (
            <g transform={`translate(${tipPin.x} ${tipPin.y}) scale(${k}) translate(0 -16)`} pointerEvents="none" className="animate-[modal-fade_140ms_ease-out]">
              <rect x={-(tipPin.text.length * 3.1 + 9)} y={-20} width={tipPin.text.length * 6.2 + 18} height={18} rx={6} fill="rgba(13,17,26,0.96)" stroke="rgba(37,99,235,0.7)" />
              <text y={-10.5} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="#E2E8F0" className="tabular-nums">
                {tipPin.text}
              </text>
            </g>
          )}
        </svg>

        {/* Compass */}
        <svg viewBox="-20 -20 40 40" className="pointer-events-none absolute bottom-2 left-2 h-9 w-9 opacity-70" aria-hidden>
          <circle r="17" fill="rgba(13,17,26,0.7)" stroke="rgba(148,163,184,0.35)" />
          <path d="M0 -13 L4 2 L0 -1 L-4 2 Z" fill="#38BDF8" />
          <path d="M0 13 L4 -2 L0 1 L-4 -2 Z" fill="rgba(148,163,184,0.5)" />
          <text y="-14.5" textAnchor="middle" fontSize="6" fontWeight="700" fill="#E2E8F0" dominantBaseline="auto">
            N
          </text>
        </svg>

        <div className="absolute top-2 right-2 flex flex-col gap-1">
          <button type="button" className={ctrl} aria-label="Zoom in" onClick={() => zoomCenter(1.5)}>
            +
          </button>
          <button type="button" className={ctrl} aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.5)}>
            −
          </button>
          <button type="button" className={ctrl} aria-label="Reset view" title="Reset view" onClick={() => glide(FULL)}>
            ⟲
          </button>
        </div>
        {editable && !compact && (
          <p className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-[#0D111A]/80 px-2 py-1 text-[11px] text-slate-300 backdrop-blur-md">
            Drag a pin to move it
          </p>
        )}
      </div>

      {error && <p className="text-xs text-rose-500">Couldn&apos;t save the pin: {error}</p>}
      {!compact && !hideUnplaced && unplaced.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-subtle">{editable ? "Not on the map, tap to place:" : "Not on the map:"}</span>
          {unplaced.map((l) => {
            const on = selectedId === l.id;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => (editable ? place(l.id) : onPick?.(l.id))}
                aria-pressed={on}
                className={`press min-h-8 rounded-full border px-2.5 py-1 text-xs font-semibold active:scale-[0.98] ${
                  on ? "border-accent bg-accent text-white" : "border-line-strong bg-surface text-fg-2 hover:border-sky-400/40 hover:text-accent"
                }`}
              >
                📍 {l.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
