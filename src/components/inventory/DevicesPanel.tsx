"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { adjustStock, removeDevice, updateDevice } from "@/app/(app)/inventory/actions";
import { Icon } from "@/components/ui/Icon";
import { askConfirm } from "@/components/ui/useConfirm";
import { useCan } from "@/components/shell/ModeContext";
import { stationRoom } from "@/config/stations";
import { MAP_H, MAP_W, WORKSHOP_ROOMS } from "@/config/workshopMap";
import type { Device } from "@/lib/inventory/devices";
import { safeAction } from "@/lib/safeAction";
import type { Item } from "./types";

// The PC stations (config/stations.ts, Harel 2026-11-20): instead of the photo and the count, a
// station's window shows the floor plan around its room with each PC as an icon on it. The view
// pans and zooms freely; once it's moved the room's outline lights up, and Reset flies back. Anyone
// who can work drags the PCs (saved on drop); a tap opens Keyboard / Mouse / Notes / Delete. + Add
// PC puts one in the middle of the room. Below: every PC with its condition (1-5) and its Delete.

type ChangeItem = (change: (i: Item) => Partial<Item>, run: () => Promise<{ error?: string }>) => void;
type Patch = Parameters<typeof updateDevice>[1];
type View = { cx: number; cy: number; w: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function DevicesPanel({
  item,
  devices: loaded,
  onChange,
  onSaved,
  onError,
}: {
  item: Item;
  devices: Device[];
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
    const n = devices.findIndex((d) => d.id === id) + 1;
    if (!(await askConfirm({ title: `Delete PC ${n}?`, body: "It's deleted for good (it doesn't go to Recently deleted), and the count goes down by one.", confirm: "Delete", danger: true }))) return;
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
  const tick = "flex min-h-9 items-center gap-1.5 text-sm text-fg-2";
  return (
    <li className="space-y-1.5 rounded-xl border border-line bg-raised p-2.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onOpen} className="press flex min-h-9 items-center gap-1.5 rounded-md px-1 text-sm font-semibold text-fg active:scale-[0.98]">
          <Icon name="pc" className="h-5 w-5" />
          <span className="tabular-nums">PC {n}</span>
        </button>
        <label className={tick}>
          <input type="checkbox" className="h-5 w-5" disabled={!work} checked={d.keyboard} onChange={(e) => onSave({ keyboard: e.target.checked })} />
          Keyboard
        </label>
        <label className={tick}>
          <input type="checkbox" className="h-5 w-5" disabled={!work} checked={d.mouse} onChange={(e) => onSave({ mouse: e.target.checked })} />
          Mouse
        </label>
        {work && (
          <button type="button" onClick={onDelete} className="press ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface hover:text-rose-500 active:scale-[0.98]" aria-label={`Delete PC ${n}`} title="Delete this PC">
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
          aria-label={`PC ${n} condition, 1 to 5`}
          className={`h-9 min-w-0 flex-1 accent-[var(--color-accent)] ${shown == null ? "opacity-40" : ""}`}
        />
        <span className="w-8 text-right font-mono font-semibold text-fg tabular-nums">{shown ?? "–"}/5</span>
      </label>
      {d.note && <p className="truncate text-xs text-muted">{d.note}</p>}
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
  // The starting view: the room with about its own size around it, so the rooms next to it show.
  const home: View = room ? { cx: room.box.cx, cy: room.box.cy, w: Math.max(room.box.w * 2.2, room.box.h * 2.2 * aspect, 220) } : { cx: MAP_W / 2, cy: MAP_H / 2, w: MAP_W };
  const [view, setView] = useState<View | null>(null);
  const [moved, setMoved] = useState(false);
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
    setMoved(true);
    const clamped = { ...next, w: clamp(next.w, 60, MAP_W * 1.6) };
    // Gestures read the newest view even before React paints it.
    live.current = { ...live.current, v: clamped };
    setView(clamped);
  };
  // Reset glides back to the starting view.
  const reset = () => {
    stopFly();
    setMoved(false);
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
          {/* The station's room lights up only once the view has moved (Harel, 2026-11-20). */}
          {moved && room && (
            <polygon points={room.points.map((p) => p.join(",")).join(" ")} style={{ fill: "color-mix(in srgb, var(--color-accent) 18%, transparent)", stroke: "var(--color-accent)" }} strokeWidth={stroke * 2.5} />
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

function PcIcon({
  n,
  at,
  open,
  movable,
  toMap,
  onTap,
  onMove,
  onDrop,
}: {
  n: number;
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
      aria-label={`PC ${n}`}
      aria-expanded={open}
      className={`press absolute z-[1] flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-white shadow-[0_2px_8px_rgba(0,0,0,0.45)] ${open ? "border-white bg-accent" : "border-white/80 bg-[#0D111A]/85"} ${movable ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ left: at.left, top: at.top }}
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

// A PC's small menu: Keyboard and Mouse ticks, its note (saved as the box loses focus or the menu
// closes) and Delete. Drawn over the map's edge rather than cut off by it.
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
  const [note, setNote] = useState(d.note ?? "");
  const latest = useRef({ note, saved: d.note ?? "", onSave });
  useEffect(() => {
    latest.current = { note, saved: d.note ?? "", onSave };
  });
  useEffect(
    () => () => {
      const { note: text, saved, onSave: save } = latest.current;
      if (text.trim() !== saved.trim()) save({ note: text });
    },
    [],
  );
  const width = Math.min(224, size.w - 8);
  const left = clamp(at.left - width / 2, 4, size.w - width - 4);
  const below = at.top < size.h / 2;
  const tick = "flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-sm font-medium text-fg hover:bg-raised";
  return (
    <div
      className="absolute z-[5] rounded-xl border border-line-strong bg-surface p-2 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
      style={{ width, left, ...(below ? { top: at.top + 26 } : { bottom: size.h - at.top + 26 }) }}
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-bold tracking-wide text-subtle uppercase">PC {n}</span>
        <button type="button" onClick={onClose} className="press flex h-9 w-9 items-center justify-center rounded-md text-subtle hover:text-fg" aria-label="Close">
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      </div>
      <label className={tick}>
        <input type="checkbox" className="h-5 w-5" disabled={!work} checked={d.keyboard} onChange={(e) => onSave({ keyboard: e.target.checked })} />
        Keyboard
      </label>
      <label className={tick}>
        <input type="checkbox" className="h-5 w-5" disabled={!work} checked={d.mouse} onChange={(e) => onSave({ mouse: e.target.checked })} />
        Mouse
      </label>
      <label className="mt-1 block px-1">
        <span className="text-xs font-semibold tracking-wide text-subtle uppercase">Notes</span>
        <textarea
          value={note}
          rows={2}
          readOnly={!work}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note.trim() !== (d.note ?? "").trim() && onSave({ note })}
          placeholder={work ? "This PC's note…" : "No note"}
          className="input mt-0.5 block w-full resize-y py-1.5 text-sm"
        />
      </label>
      {work && (
        <button type="button" onClick={onDelete} className="press mt-1 flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-sm font-medium text-rose-500 hover:bg-raised active:scale-[0.98]">
          <Icon name="close" className="h-4 w-4" /> Delete PC
        </button>
      )}
    </div>
  );
}
