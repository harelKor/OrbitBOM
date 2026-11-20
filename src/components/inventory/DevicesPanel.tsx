"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { adjustStock, removeDevice, updateDevice } from "@/app/(app)/inventory/actions";
import { Icon } from "@/components/ui/Icon";
import { askConfirm } from "@/components/ui/useConfirm";
import { useCan } from "@/components/shell/ModeContext";
import { stationRoom } from "@/config/stations";
import { MAP_H, MAP_W, WORKSHOP_ROOMS } from "@/config/workshopMap";
import type { Device, StationPanorama } from "@/lib/inventory/devices";
import { PanoramaStage, type PanoTools } from "@/components/map/PanoramaStage";
import { facing, mod1 } from "@/components/map/panorama";
import { safeAction } from "@/lib/safeAction";
import { textOn } from "@/components/bom/options";
import type { Item } from "./types";

// The PC stations (config/stations.ts, Harel 2026-11-20): instead of the photo and the count, a
// station's window shows the floor plan around its room with each PC as an icon on it. The view
// pans and zooms freely with the room's outline always lit, and Reset flies back. Anyone
// who can work drags the PCs (saved on drop); a tap opens its note and Delete. + Add
// PC puts one in the middle of the room. Below: every PC with its condition (1-5) and its Delete.
// Each PC has its own name (pencil beside it) and GPU / CPU / RAM, edited in its menu on the map
// and listed under it (Harel, 2026-11-20). When a zone in the station's room has a 360° picture
// (the CAD PC's cage), the window stands you in it instead: it opens facing the PCs, each PC's icon
// sits on the PC in the picture (pano_x / pano_y) and drags to another (Harel, 2026-11-20).

type ChangeItem = (change: (i: Item) => Partial<Item>, run: () => Promise<{ error?: string }>) => void;
type Patch = Parameters<typeof updateDevice>[1];
type View = { cx: number; cy: number; w: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// A PC's condition as a colour, red at 1 through amber to green at 5 (Harel, 2026-11-20): its
// slider and its icon on the map. No condition: no colour (the neutral icon).
const CONDITION_COLORS = ["#DC2626", "#EA580C", "#EAB308", "#84CC16", "#16A34A"];
const conditionColor = (c: number | null | undefined) => (c ? CONDITION_COLORS[clamp(Math.round(c), 1, 5) - 1] : null);
// A PC with no name of its own is "PC n" by its place in the list.
const pcName = (d: Device, n: number) => d.name || `PC ${n}`;
const SPECS = [
  { key: "gpu", label: "GPU", hint: "e.g. RTX 3060" },
  { key: "cpu", label: "CPU", hint: "e.g. i5-12400" },
  { key: "ram", label: "RAM", hint: "e.g. 16 GB" },
] as const;

export function DevicesPanel({
  item,
  devices: loaded,
  panorama,
  onChange,
  onSaved,
  onError,
}: {
  item: Item;
  devices: Device[];
  panorama?: StationPanorama | null;
  onChange: ChangeItem;
  onSaved: () => void;
  onError: (m: string | null) => void;
}) {
  const work = useCan("work");
  const [devices, setDevices] = useState(loaded);
  const [seen, setSeen] = useState(loaded);
  const [open, setOpen] = useState<string | null>(null);
  const [, start] = useTransition();
  // A reload (another phone, a + that landed) brings the saved PCs.
  if (seen !== loaded) {
    setSeen(loaded);
    setDevices(loaded);
  }

  const save = (id: string, patch: Patch) => {
    setDevices((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    start(async () => {
      const r = await safeAction(() => updateDevice(id, patch));
      onError(r.error ?? null);
      if (r.error) onSaved();
    });
  };
  const add = () => {
    onError(null);
    onChange(
      (i) => ({ inStock: i.inStock + 1 }),
      async () => {
        const r = await adjustStock(item.id, 1);
        if (!r.error) onSaved();
        return r;
      },
    );
  };
  // Asked before anything runs (never inside a transition: the question couldn't show).
  const remove = async (id: string) => {
    const n = devices.findIndex((d) => d.id === id);
    if (n < 0 || !(await askConfirm({ title: `Delete ${pcName(devices[n], n + 1)}?`, confirm: "Delete", danger: true }))) return;
    setOpen(null);
    setDevices((ds) => ds.filter((d) => d.id !== id));
    onChange(
      (i) => ({ inStock: Math.max(0, i.inStock - 1) }),
      async () => {
        const r = await removeDevice(item.id, id);
        if (!r.error) onSaved();
        return r;
      },
    );
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted">
          <span className="font-mono text-lg font-semibold text-fg tabular-nums">{devices.length}</span> {devices.length === 1 ? "PC" : "PCs"}
        </span>
        {work && (
          <button type="button" onClick={add} className="btn-primary min-h-11 px-4 active:scale-[0.98]">
            + Add PC
          </button>
        )}
      </div>

      {panorama ? (
        <StationPano
          panorama={panorama}
          devices={devices}
          open={open}
          movable={work}
          onOpen={setOpen}
          onMove={(id, u, v) => setDevices((ds) => ds.map((d) => (d.id === id ? { ...d, panoX: u, panoY: v } : d)))}
          onSave={save}
          onDelete={remove}
        />
      ) : (
      <StationMap
        station={item.station ?? null}
        devices={devices}
        open={open}
        movable={work}
        onOpen={setOpen}
        onMove={(id, x, y) => setDevices((ds) => ds.map((d) => (d.id === id ? { ...d, x, y } : d)))}
        onSave={save}
        onDelete={remove}
      />
      )}

      {devices.length > 0 && (
        // Two PCs a row from tablets up, one on phones.
        <ul className="grid gap-2 sm:grid-cols-2">
          {devices.map((d, i) => (
            <PcRow key={d.id} device={d} n={i + 1} work={work} onSave={(p) => save(d.id, p)} onDelete={() => remove(d.id)} onOpen={() => setOpen(d.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PcRow({ device: d, n, work, onSave, onDelete, onOpen }: { device: Device; n: number; work: boolean; onSave: (p: Patch) => void; onDelete: () => void; onOpen: () => void }) {
  const [level, setLevel] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = level ?? d.condition;
  // The slider saves once it rests, not on every step of a drag.
  const slide = (v: number) => {
    setLevel(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLevel(null);
      if (v !== d.condition) onSave({ condition: v });
    }, 400);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <li className="space-y-1.5 rounded-xl border border-line bg-raised p-2.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onOpen} className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-fg active:scale-[0.98]" aria-label={`Show ${pcName(d, n)} on the map`} title="Show on the map">
          <Icon name="pc" className="h-5 w-5" />
        </button>
        <PcName device={d} n={n} work={work} onSave={onSave} className="text-sm" />
        {work && (
          <button type="button" onClick={onDelete} className="press ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface hover:text-rose-500 active:scale-[0.98]" aria-label={`Delete ${pcName(d, n)}`} title="Delete this PC">
            <Icon name="close" className="h-4 w-4" />
          </button>
        )}
      </div>
      <label className="flex items-center gap-2.5 text-sm text-muted">
        Condition
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          disabled={!work}
          value={shown ?? 3}
          onChange={(e) => slide(Number(e.target.value))}
          aria-label={`${pcName(d, n)} condition, 1 to 5`}
          style={{ accentColor: conditionColor(shown) ?? "var(--color-accent)" }}
          className={`h-9 min-w-0 flex-1 ${shown == null ? "opacity-40" : ""}`}
        />
        <span className="w-8 text-right font-mono font-semibold text-fg tabular-nums">{shown ?? "–"}/5</span>
      </label>
      <PcSpecs device={d} />
      <PcNote device={d} work={work} onSave={onSave} />
    </li>
  );
}

// The floor plan around the station's room: rooms only, never the inventory's zones and spots.
function StationMap({
  station,
  devices,
  open,
  movable,
  onOpen,
  onMove,
  onSave,
  onDelete,
}: {
  station: string | null;
  devices: Device[];
  open: string | null;
  movable: boolean;
  onOpen: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onSave: (id: string, p: Patch) => void;
  onDelete: (id: string) => void;
}) {
  const room = stationRoom(station);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const aspect = size.w && size.h ? size.w / size.h : 4 / 3;
  // The starting view: the room close up with a strip of what's around it, enough to know where
  // it is; how close is each station's `zoom` (config/stations.ts).
  const home: View = room ? { cx: room.box.cx, cy: room.box.cy, w: Math.max(room.box.w * room.zoom, room.box.h * room.zoom * aspect, 120) } : { cx: MAP_W / 2, cy: MAP_H / 2, w: MAP_W };
  const [view, setView] = useState<View | null>(null);
  const v = view ?? home;
  const h = v.w / aspect;
  const x0 = v.cx - v.w / 2;
  const y0 = v.cy - h / 2;
  const live = useRef({ v, size, x0, y0, h });
  useEffect(() => {
    live.current = { v, size, x0, y0, h };
  });
  const fly = useRef<number | null>(null);
  const stopFly = () => {
    if (fly.current) cancelAnimationFrame(fly.current);
    fly.current = null;
  };
  const move = (next: View) => {
    stopFly();
    const clamped = { ...next, w: clamp(next.w, 60, MAP_W * 1.6) };
    // Gestures read the newest view even before React paints it.
    live.current = { ...live.current, v: clamped };
    setView(clamped);
  };
  // Reset glides back to the starting view.
  const reset = () => {
    stopFly();
    const from = live.current.v;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 450);
      const e = 1 - (1 - k) ** 3;
      setView(k >= 1 ? null : { cx: from.cx + (home.cx - from.cx) * e, cy: from.cy + (home.cy - from.cy) * e, w: from.w + (home.w - from.w) * e });
      fly.current = k >= 1 ? null : requestAnimationFrame(step);
    };
    fly.current = requestAnimationFrame(step);
  };
  useEffect(() => () => stopFly(), []);

  // Zoom about a screen point (px in the box) by `k` (< 1 zooms in).
  const zoomAt = (px: number, py: number, k: number) => {
    const { v: cur, size: s } = live.current;
    const ch = cur.w / aspect;
    const ax = cur.cx - cur.w / 2;
    const ay = cur.cy - ch / 2;
    const mx = ax + (px / s.w) * cur.w;
    const my = ay + (py / s.h) * ch;
    const w = clamp(cur.w * k, 60, MAP_W * 1.6);
    const nh = w / aspect;
    move({ cx: mx - (px / s.w) * w + w / 2, cy: my - (py / s.h) * nh + nh / 2, w });
  };
  // Wheel zoom needs a listener that may stop the page scrolling.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });

  // One finger (or the mouse) pans, two pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    onOpen(null);
  };
  const onPan = (e: React.PointerEvent) => {
    const p = pointers.current;
    const last = p.get(e.pointerId);
    if (!last) return;
    const { v: cur, size: s } = live.current;
    if (p.size === 1) {
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      p.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!dx && !dy) return;
      const k = cur.w / s.w;
      move({ ...cur, cx: cur.cx - dx * k, cy: cur.cy - dy * k });
    } else if (p.size === 2) {
      const [a, b] = [...p.entries()];
      const other = a[0] === e.pointerId ? b[1] : a[1];
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      p.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!before || !after) return;
      const r = box.current!.getBoundingClientRect();
      zoomAt((e.clientX + other.x) / 2 - r.left, (e.clientY + other.y) / 2 - r.top, before / after);
    }
  };
  const onUp = (e: React.PointerEvent) => void pointers.current.delete(e.pointerId);

  const screen = (x: number, y: number) => ({ left: ((x - x0) / v.w) * size.w, top: ((y - y0) / h) * size.h });
  const toMap = (clientX: number, clientY: number): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [clamp(x0 + ((clientX - r.left) / r.width) * v.w, 0, MAP_W), clamp(y0 + ((clientY - r.top) / r.height) * h, 0, MAP_H)];
  };
  const opened = devices.find((d) => d.id === open);
  const stroke = v.w / 300;
  return (
    <div className="relative">
      <div
        ref={box}
        className="thumb-well relative aspect-[4/3] w-full touch-none overflow-hidden rounded-xl select-none sm:aspect-[16/9]"
        onPointerDown={onDown}
        onPointerMove={onPan}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <svg viewBox={`${x0} ${y0} ${v.w} ${h}`} className="absolute inset-0 h-full w-full" aria-hidden>
          {WORKSHOP_ROOMS.map((r) => (
            <polygon key={r.id} points={r.points} className={r.main ? "fill-raised stroke-line-strong" : "fill-surface stroke-line-strong"} strokeWidth={stroke} />
          ))}
          {/* The station's room is always lit, softly (Harel, 2026-11-20). */}
          {room && (
            <polygon points={room.points.map((p) => p.join(",")).join(" ")} style={{ fill: "color-mix(in srgb, var(--color-accent) 10%, transparent)", stroke: "color-mix(in srgb, var(--color-accent) 65%, transparent)" }} strokeWidth={stroke * 2} />
          )}
          {WORKSHOP_ROOMS.map((r) => (
            <text key={r.id} x={r.labelPos[0]} y={r.labelPos[1]} fontSize={r.labelSize} textAnchor="middle" dominantBaseline="middle" className="fill-subtle font-semibold">
              {r.label}
            </text>
          ))}
        </svg>
        {size.w > 0 &&
          devices.map((d, i) => (
            <PcIcon
              key={d.id}
              n={i + 1}
              name={pcName(d, i + 1)}
              color={conditionColor(d.condition)}
              at={screen(d.x, d.y)}
              open={open === d.id}
              movable={movable}
              toMap={toMap}
              onTap={() => onOpen(open === d.id ? null : d.id)}
              onMove={(x, y) => onMove(d.id, x, y)}
              onDrop={(x, y) => onSave(d.id, { x, y })}
            />
          ))}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={reset}
          className="press absolute right-2 bottom-2 z-[2] flex min-h-9 items-center gap-1.5 rounded-full border border-white/30 bg-[#0D111A]/80 px-3 text-xs font-semibold text-white backdrop-blur-md active:scale-[0.98]"
        >
          <Icon name="undo" className="h-3.5 w-3.5" /> Reset
        </button>
      </div>
      {opened && size.w > 0 && (
        <PcMenu
          key={opened.id}
          device={opened}
          n={devices.indexOf(opened) + 1}
          at={screen(opened.x, opened.y)}
          size={size}
          work={movable}
          onClose={() => onOpen(null)}
          onSave={(p) => onSave(opened.id, p)}
          onDelete={() => onDelete(opened.id)}
        />
      )}
    </div>
  );
}

// Where a PC sits on the panorama: its saved spot, or (not put there yet) in a row below where the
// placed ones are, to be dragged onto its computer.
function panoSpot(d: Device, devices: Device[], pic: { w: number; h: number }) {
  if (d.panoX != null && d.panoY != null) return { u: d.panoX, v: d.panoY };
  const placed = devices.filter((x) => x.panoX != null && x.panoY != null).map((x) => ({ u: x.panoX!, v: x.panoY! }));
  const centre = facing(placed, pic, { w: 4, h: 3 }).u;
  const loose = devices.filter((x) => x.panoX == null || x.panoY == null);
  const i = loose.indexOf(d);
  return { u: mod1(centre + (i - (loose.length - 1) / 2) * 0.03), v: 0.62 };
}

// The station's room as its 360° picture: you stand in it, drag to look round, pinch to zoom.
function StationPano({
  panorama,
  devices,
  open,
  movable,
  onOpen,
  onMove,
  onSave,
  onDelete,
}: {
  panorama: StationPanorama;
  devices: Device[];
  open: string | null;
  movable: boolean;
  onOpen: (id: string | null) => void;
  onMove: (id: string, u: number, v: number) => void;
  onSave: (id: string, p: Patch) => void;
  onDelete: (id: string) => void;
}) {
  const pic = { w: panorama.imageW, h: panorama.imageH };
  const spots = devices.map((d) => ({ d, at: panoSpot(d, devices, pic) }));
  const icon = (t: PanoTools) =>
    spots.map(({ d, at }, i) => {
      const s = t.at(at.u, at.v);
      if (!s.front) return null;
      const color = conditionColor(d.condition);
      return (
        <div key={d.id} className="contents">
          {/* A soft light on the PC, so it reads at a glance in a busy room. */}
          <span
            aria-hidden
            className="pointer-events-none absolute h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: s.x, top: s.y, background: `radial-gradient(circle, color-mix(in srgb, ${color ?? "var(--color-accent)"} 55%, transparent) 0%, transparent 68%)` }}
          />
          <PcIcon
            n={i + 1}
            name={pcName(d, i + 1)}
            color={color}
            at={{ left: s.x, top: s.y }}
            open={open === d.id}
            movable={movable}
            toMap={(x, y) => {
              const q = t.under(x, y);
              return [q.u, q.v];
            }}
            onTap={() => onOpen(open === d.id ? null : d.id)}
            onMove={(u, v) => onMove(d.id, u, v)}
            onDrop={(u, v) => onSave(d.id, { panoX: Math.round(u * 10000) / 10000, panoY: Math.round(v * 10000) / 10000 })}
          />
        </div>
      );
    });
  const opened = spots.find((s) => s.d.id === open);
  return (
    <PanoramaStage
      src={panorama.imageUrl}
      pic={pic}
      // Facing the PCs that are placed, as close as shows them (Harel, 2026-11-20).
      start={(box) => facing(spots.filter((s) => s.d.panoX != null).map((s) => s.at), pic, box)}
      className="thumb-well aspect-[4/3] w-full rounded-xl sm:aspect-[16/9]"
      onBackground={() => onOpen(null)}
      outside={(t) => {
        if (!opened) return null;
        const s = t.at(opened.at.u, opened.at.v);
        if (!s.front) return null;
        return (
          <PcMenu
            key={opened.d.id}
            device={opened.d}
            n={devices.indexOf(opened.d) + 1}
            at={{ left: Math.min(Math.max(s.x, 0), t.box.w), top: Math.min(Math.max(s.y, 0), t.box.h) }}
            size={t.box}
            work={movable}
            onClose={() => onOpen(null)}
            onSave={(p) => onSave(opened.d.id, p)}
            onDelete={() => onDelete(opened.d.id)}
          />
        );
      }}
    >
      {icon}
    </PanoramaStage>
  );
}

function PcIcon({
  n,
  name,
  color,
  at,
  open,
  movable,
  toMap,
  onTap,
  onMove,
  onDrop,
}: {
  n: number;
  name: string;
  color: string | null;
  at: { left: number; top: number };
  open: boolean;
  movable: boolean;
  toMap: (x: number, y: number) => [number, number];
  onTap: () => void;
  onMove: (x: number, y: number) => void;
  onDrop: (x: number, y: number) => void;
}) {
  const drag = useRef<{ x: number; y: number; moved: boolean; at: [number, number] } | null>(null);
  const dragged = useRef(false); // the click that ends a drag doesn't open the menu
  const end = () => {
    const g = drag.current;
    drag.current = null;
    dragged.current = !!g?.moved;
    if (g?.moved) onDrop(...g.at);
  };
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      aria-expanded={open}
      // A condition colours the icon (white rim and a dark shadow keep it clear on any floor or
      // theme); open, it wears the accent ring.
      className={`press absolute z-[1] flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] ${color ? "" : open ? "bg-accent" : "border-white/80 bg-[#0D111A]/85"} ${open ? "ring-4 ring-accent/50" : ""} ${movable ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ left: at.left, top: at.top, ...(color ? { backgroundColor: color, color: textOn(color) } : {}) }}
      onPointerDown={(e) => {
        // The icon, not the map, takes this pointer.
        e.stopPropagation();
        if (!movable) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, moved: false, at: [0, 0] };
      }}
      onPointerMove={(e) => {
        const g = drag.current;
        if (!g) return;
        e.stopPropagation();
        if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6) return;
        g.moved = true;
        g.at = toMap(e.clientX, e.clientY);
        onMove(...g.at);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={() => {
        if (dragged.current) return void (dragged.current = false);
        onTap();
      }}
    >
      <Icon name="pc" className="h-5 w-5" />
      <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[0.625rem] font-bold text-[#0D111A] tabular-nums">{n}</span>
    </button>
  );
}

// A PC's note (Harel, 2026-11-20): just its text, lightly highlighted like a marker, and only when
// there is one. A tap on it edits it in place; "Add note" starts one; an emptied note goes. Saved
// when the box loses focus, or when it goes (the menu closed by a tap elsewhere).
function PcNote({ device: d, work, onSave }: { device: Device; work: boolean; onSave: (p: Patch) => void }) {
  const [text, setText] = useState<string | null>(null); // being edited
  const latest = useRef({ text, saved: d.note ?? "", onSave });
  useEffect(() => {
    latest.current = { text, saved: d.note ?? "", onSave };
  });
  useEffect(
    () => () => {
      const { text: t, saved, onSave: save } = latest.current;
      if (t !== null && t.trim() !== saved.trim()) save({ note: t });
    },
    [],
  );
  const done = () => {
    if (text !== null && text.trim() !== (d.note ?? "").trim()) onSave({ note: text });
    setText(null);
  };
  // Escape drops the edit; the blur that follows must not save it.
  const cancel = () => {
    latest.current = { ...latest.current, text: null };
    setText(null);
  };
  if (text !== null)
    return (
      <textarea
        autoFocus
        value={text}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => latest.current.text !== null && done()}
        onKeyDown={(e) => e.key === "Escape" && cancel()}
        placeholder="A note about this PC…"
        aria-label="Note"
        className="input block w-full resize-y py-1.5 text-base leading-snug"
      />
    );
  if (d.note) {
    const mark = <mark className="box-decoration-clone rounded-sm bg-amber-300/40 px-1 text-base leading-relaxed text-fg dark:bg-amber-400/25">{d.note}</mark>;
    return work ? (
      <button type="button" onClick={() => setText(d.note ?? "")} className="block min-h-9 w-full py-0.5 text-left whitespace-pre-wrap" aria-label="Edit the note">
        {mark}
      </button>
    ) : (
      <p className="whitespace-pre-wrap">{mark}</p>
    );
  }
  return work ? (
    <button type="button" onClick={() => setText("")} className="press min-h-9 px-1 text-sm font-medium text-muted hover:text-accent active:scale-[0.98]">
      + Add note
    </button>
  ) : null;
}

// A text being typed, saved when it's left: on blur, or when the box goes (the menu closed by a tap
// elsewhere). Escape drops it, and the blur that follows mustn't save it.
function useDraft(saved: string, save: (v: string) => void) {
  const [text, setText] = useState<string | null>(null);
  const latest = useRef({ text, saved, save });
  useEffect(() => {
    latest.current = { text, saved, save };
  });
  useEffect(
    () => () => {
      const { text: t, saved: was, save: put } = latest.current;
      if (t !== null && t.trim() !== was.trim()) put(t);
    },
    [],
  );
  const done = () => {
    const { text: t, saved: was, save: put } = latest.current;
    if (t !== null && t.trim() !== was.trim()) put(t);
    latest.current = { ...latest.current, text: null };
    setText(null);
  };
  const cancel = () => {
    latest.current = { ...latest.current, text: null };
    setText(null);
  };
  return { text, setText, done, cancel };
}

// A PC's name with a small pencil beside it that edits it in place (Harel, 2026-11-20). Enter or
// leaving the box saves; an emptied name goes back to "PC n".
function PcName({ device: d, n, work, onSave, className = "" }: { device: Device; n: number; work: boolean; onSave: (p: Patch) => void; className?: string }) {
  const { text, setText, done, cancel } = useDraft(d.name ?? "", (v) => onSave({ name: v.trim() || null }));
  if (text !== null)
    return (
      <input
        autoFocus
        value={text}
        maxLength={80}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") done();
          else if (e.key === "Escape") cancel();
        }}
        placeholder={`PC ${n}`}
        aria-label="PC name"
        className="input min-h-9 min-w-0 flex-1 py-1 text-base font-semibold"
      />
    );
  return (
    <span className={`flex min-w-0 items-center gap-0.5 ${className}`}>
      <span className="truncate font-semibold text-fg tabular-nums">{pcName(d, n)}</span>
      {work && (
        <button type="button" onClick={() => setText(d.name ?? "")} className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-subtle hover:text-accent active:scale-[0.98]" aria-label={`Rename ${pcName(d, n)}`} title="Rename">
          <Icon name="pencil" className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

// A PC's GPU / CPU / RAM as a short list, only the ones filled in.
function PcSpecs({ device: d, className = "" }: { device: Device; className?: string }) {
  const filled = SPECS.filter((f) => d[f.key]);
  if (!filled.length) return null;
  return (
    <dl className={`grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 px-1 text-sm ${className}`}>
      {filled.map((f) => (
        <div key={f.key} className="contents">
          <dt className="font-semibold text-subtle">{f.label}</dt>
          <dd className="min-w-0 break-words text-fg">{d[f.key]}</dd>
        </div>
      ))}
    </dl>
  );
}

// One of a PC's parts (GPU / CPU / RAM), free text, in its menu: saved when left, blank clears it.
function SpecField({ field, device: d, onSave }: { field: (typeof SPECS)[number]; device: Device; onSave: (p: Patch) => void }) {
  const saved = d[field.key] ?? "";
  const { text, setText, done, cancel } = useDraft(saved, (v) => onSave({ [field.key]: v.trim() || null }));
  return (
    <label className="contents">
      <span className="text-xs font-bold tracking-wide text-subtle uppercase">{field.label}</span>
      <input
        value={text ?? saved}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") cancel();
        }}
        placeholder={field.hint}
        className="input min-h-9 min-w-0 py-1 text-base"
      />
    </label>
  );
}

// A PC's small menu: its name, parts, note and Delete. Drawn over the map's edge rather than cut off by it.
function PcMenu({
  device: d,
  n,
  at,
  size,
  work,
  onClose,
  onSave,
  onDelete,
}: {
  device: Device;
  n: number;
  at: { left: number; top: number };
  size: { w: number; h: number };
  work: boolean;
  onClose: () => void;
  onSave: (p: Patch) => void;
  onDelete: () => void;
}) {
  const width = Math.min(272, size.w - 8);
  const left = clamp(at.left - width / 2, 4, size.w - width - 4);
  const below = at.top < size.h / 2;
  return (
    <div
      className="absolute z-[5] rounded-xl border border-line-strong bg-surface p-2 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
      style={{ width, left, ...(below ? { top: at.top + 26 } : { bottom: size.h - at.top + 26 }) }}
    >
      <div className="mb-1 flex items-center justify-between gap-1 pl-1">
        <PcName device={d} n={n} work={work} onSave={onSave} className="text-sm" />
        <button type="button" onClick={onClose} className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-subtle hover:text-fg" aria-label="Close">
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      </div>
      {work ? (
        <div className="mb-1.5 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 px-1">
          {SPECS.map((f) => (
            <SpecField key={f.key} field={f} device={d} onSave={onSave} />
          ))}
        </div>
      ) : (
        <PcSpecs device={d} className="mb-1.5" />
      )}
      <PcNote device={d} work={work} onSave={onSave} />
      {work && (
        <button type="button" onClick={onDelete} className="press mt-1 flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-rose-500 hover:bg-raised active:scale-[0.98]">
          <Icon name="close" className="h-4 w-4" /> Delete PC
        </button>
      )}
    </div>
  );
}
