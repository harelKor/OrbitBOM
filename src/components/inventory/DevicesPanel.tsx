"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { adjustStock, removeDevice, updateDevice } from "@/app/(app)/inventory/actions";
import { StepButton } from "@/components/ui/Stepper";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useCan } from "@/components/shell/ModeContext";
import { WORKSHOP_ROOMS } from "@/config/workshopMap";
import type { Device } from "@/lib/inventory/devices";
import { bounds, placeIndex, zoneOf } from "@/lib/inventory/places";
import { safeAction } from "@/lib/safeAction";
import type { InvCategory, Item, Location } from "./types";

// Computers & Devices (Harel, 2026-11-20): instead of the photo and the count, a devices item's
// window shows its zone's picture from the shop map (a drawer's zone; the zone's outline on the
// floor plan when it has no picture) with each device as an icon on it. Anyone who can work drags
// them (saved on drop); a tap opens Keyboard / Mouse / Notes. + adds a device in the middle, −
// asks which one goes. Below: every device with its specs, edited in place.

type ChangeItem = (change: (i: Item) => Partial<Item>, run: () => Promise<{ error?: string }>) => void;

const iconOf = (type: string | undefined): IconName => (type === "Laptop" ? "laptop" : type === "Tablet" ? "tablet" : "pc");
const clamp = (v: number) => Math.min(1, Math.max(0, v));

export function DevicesPanel({
  item,
  cat,
  places,
  devices: loaded,
  onChange,
  onSaved,
  onError,
}: {
  item: Item;
  cat: InvCategory;
  places: Location[];
  devices: Device[];
  onChange: ChangeItem;
  onSaved: () => void;
  onError: (m: string | null) => void;
}) {
  const work = useCan("work");
  const [devices, setDevices] = useState(loaded);
  const [seen, setSeen] = useState(loaded);
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [, start] = useTransition();
  // A reload (another phone, a + that landed) brings the saved devices.
  if (seen !== loaded) {
    setSeen(loaded);
    setDevices(loaded);
  }
  const zone = zoneOf(item.locationId, placeIndex(places));
  const typeField = cat.fields.find((f) => f.id === "type");

  const save = (id: string, patch: Parameters<typeof updateDevice>[1]) => {
    setDevices((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch, specs: patch.specs ? { ...d.specs, ...patch.specs } : d.specs } : d)));
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
  const remove = (id: string) => {
    setRemoving(false);
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
  const minus = () => {
    if (devices.length === 1) return remove(devices[0].id);
    setOpen(null);
    setRemoving((r) => !r);
  };
  const number = (id: string) => devices.findIndex((d) => d.id === id) + 1;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted">
          <span className="font-mono text-lg font-semibold text-fg tabular-nums">{devices.length}</span> {devices.length === 1 ? "device" : "devices"} here
        </span>
        {work && (
          <div className="flex items-center gap-2">
            <StepButton step={-1} size="lg" onClick={minus} disabled={!devices.length} label="Take a device off" />
            <StepButton step={1} size="lg" onClick={add} label="Add a device" />
          </div>
        )}
      </div>

      <ZoneBoard zone={zone}>
        {(box) => (
          <>
            {devices.map((d) => (
              <DeviceIcon
                key={d.id}
                device={d}
                n={number(d.id)}
                box={box}
                icon={iconOf(d.specs.type)}
                removing={removing}
                open={open === d.id}
                movable={work && !removing}
                onTap={() => (removing ? remove(d.id) : setOpen((o) => (o === d.id ? null : d.id)))}
                onMove={(x, y) => setDevices((ds) => ds.map((x2) => (x2.id === d.id ? { ...x2, x, y } : x2)))}
                onDrop={(x, y) => save(d.id, { x, y })}
                onClose={() => setOpen(null)}
                onSave={(patch) => save(d.id, patch)}
              />
            ))}
            {removing && (
              <div className="absolute inset-x-2 top-2 z-[3] flex items-center justify-between gap-2 rounded-lg bg-rose-600/95 px-3 py-1.5 text-sm font-semibold text-white">
                Tap the device to take off
                <button type="button" className="press min-h-9 rounded-md px-2 text-white/90 underline active:scale-[0.98]" onClick={() => setRemoving(false)}>
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </ZoneBoard>

      {devices.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-raised">
          {devices.map((d, i) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
              <button
                type="button"
                onClick={() => (removing ? remove(d.id) : setOpen((o) => (o === d.id ? null : d.id)))}
                className={`press flex min-h-9 items-center gap-1.5 rounded-md px-1 text-sm font-semibold active:scale-[0.98] ${removing ? "text-rose-500" : "text-fg"}`}
              >
                <Icon name={iconOf(d.specs.type)} className="h-5 w-5" />
                <span className="tabular-nums">#{i + 1}</span>
              </button>
              {cat.fields
                .filter((f) => !f.hidden)
                .map((f) =>
                  f.kind === "options" ? (
                    <select
                      key={f.id}
                      aria-label={f.label}
                      disabled={!work}
                      value={d.specs[f.id] ?? ""}
                      onChange={(e) => save(d.id, { specs: { [f.id]: e.target.value } })}
                      className="input min-h-9 w-auto py-1 text-sm"
                    >
                      <option value="">{f.label}</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <SpecBox key={`${f.id}:${d.specs[f.id] ?? ""}`} label={f.label} value={d.specs[f.id] ?? ""} number={f.kind === "number"} outOf={f.id === "condition" ? 10 : undefined} disabled={!work} onSave={(v) => save(d.id, { specs: { [f.id]: v } })} />
                  ),
                )}
              <span className="ml-auto flex gap-1 text-xs text-muted">
                {d.keyboard && <span className="rounded-full bg-surface px-2 py-0.5">Keyboard</span>}
                {d.mouse && <span className="rounded-full bg-surface px-2 py-0.5">Mouse</span>}
              </span>
              {d.note && <p className="w-full truncate pl-8 text-xs text-muted">{d.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {!typeField && devices.length > 0 && <p className="text-xs text-muted">Add a &ldquo;Type&rdquo; field (Laptop / PC / Tablet) to this category in Settings to pick each device&apos;s icon.</p>}
    </div>
  );
}

// A spec typed in place (Condition 7 /10), saved when the box loses focus.
function SpecBox({ label, value, number, outOf, disabled, onSave }: { label: string; value: string; number: boolean; outOf?: number; disabled: boolean; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  const done = () => {
    let v = text.trim();
    if (number && v) {
      const n = Number(v);
      if (!Number.isFinite(n)) return setText(value);
      v = String(outOf ? Math.min(outOf, Math.max(0, n)) : n);
    }
    setText(v);
    if (v !== value) onSave(v);
  };
  return (
    <label className="flex items-center gap-1 text-sm text-muted">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <input
        value={text}
        disabled={disabled}
        inputMode={number ? "decimal" : "text"}
        onChange={(e) => setText(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        placeholder={outOf ? "–" : label}
        aria-label={label}
        className={`input min-h-9 py-1 text-center font-mono tabular-nums ${number ? "w-14" : "w-32"}`}
      />
      {outOf && <span className="font-mono tabular-nums">/{outOf}</span>}
    </label>
  );
}

// The zone's picture (or its outline on the floor plan), with the devices drawn over it. Children
// get the box element so a drag can turn the pointer into 0..1 of it.
function ZoneBoard({ zone, children }: { zone: Location | undefined; children: (box: React.RefObject<HTMLDivElement | null>) => React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const outline = zone?.outline?.length ? zone.outline : null;
  const b = outline ? bounds(outline) : null;
  // The outline with a little room around it, never so thin it can't hold the icons.
  const pad = b ? Math.max(b.w, b.h) * 0.12 + 10 : 0;
  const view = b ? { x: b.x0 - pad, y: b.y0 - pad, w: b.w + 2 * pad, h: b.h + 2 * pad } : null;
  const aspect = zone?.imageUrl ? (zone.imageW && zone.imageH ? zone.imageW / zone.imageH : 16 / 10) : view ? Math.min(2.4, Math.max(1, view.w / view.h)) : 16 / 10;
  return (
    <div ref={box} className="thumb-well relative w-full overflow-hidden rounded-xl select-none" style={{ aspectRatio: aspect }}>
      {zone?.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed R2 link, drawn as is
        <img src={zone.imageUrl} alt="" className="absolute inset-0 h-full w-full" draggable={false} />
      ) : view && outline ? (
        <svg viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          {WORKSHOP_ROOMS.map((r) => (
            <polygon key={r.id} points={r.points} className="fill-surface stroke-line-strong" strokeWidth={view.w / 250} />
          ))}
          <polygon points={outline.map((p) => p.join(",")).join(" ")} style={{ fill: "color-mix(in srgb, var(--color-accent) 22%, transparent)", stroke: "var(--color-accent)" }} strokeWidth={view.w / 150} />
        </svg>
      ) : (
        <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-sm text-muted">Put this item in a zone to see its devices on the shop map.</p>
      )}
      {children(box)}
    </div>
  );
}

function DeviceIcon({
  device: d,
  n,
  box,
  icon,
  removing,
  open,
  movable,
  onTap,
  onMove,
  onDrop,
  onClose,
  onSave,
}: {
  device: Device;
  n: number;
  box: React.RefObject<HTMLDivElement | null>;
  icon: IconName;
  removing: boolean;
  open: boolean;
  movable: boolean;
  onTap: () => void;
  onMove: (x: number, y: number) => void;
  onDrop: (x: number, y: number) => void;
  onClose: () => void;
  onSave: (patch: Parameters<typeof updateDevice>[1]) => void;
}) {
  const drag = useRef<{ x: number; y: number; moved: boolean; at: [number, number] } | null>(null);
  const dragged = useRef(false); // the click that ends a drag doesn't open the menu
  const place = (e: React.PointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  };
  return (
    <div className="absolute z-[1]" style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%`, zIndex: open ? 4 : undefined }}>
      <button
        type="button"
        aria-label={`Device ${n}`}
        aria-expanded={open}
        // Touch drags move the icon, not the page.
        style={{ touchAction: movable ? "none" : undefined }}
        className={`press flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 shadow-[0_2px_8px_rgba(0,0,0,0.45)] ${removing ? "animate-pulse border-white bg-rose-600 text-white" : open ? "border-white bg-accent text-white" : "border-white/80 bg-[#0D111A]/85 text-white"} ${movable ? "cursor-grab active:cursor-grabbing" : ""}`}
        onPointerDown={(e) => {
          if (!movable) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, moved: false, at: [d.x, d.y] };
        }}
        onPointerMove={(e) => {
          const g = drag.current;
          if (!g) return;
          if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6) return;
          g.moved = true;
          g.at = place(e);
          onMove(...g.at);
        }}
        onPointerUp={() => {
          const g = drag.current;
          drag.current = null;
          dragged.current = !!g?.moved;
          if (g?.moved) onDrop(...g.at);
        }}
        onPointerCancel={() => {
          const g = drag.current;
          drag.current = null;
          if (g?.moved) onDrop(...g.at);
        }}
        onClick={() => {
          // A drag ends in a click too; only a tap opens the menu.
          if (dragged.current) return void (dragged.current = false);
          onTap();
        }}
      >
        <Icon name={icon} className="h-5 w-5" />
        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[0.625rem] font-bold text-[#0D111A] tabular-nums">{n}</span>
      </button>
      {open && <DeviceMenu device={d} n={n} below={d.y < 0.5} right={d.x > 0.6} onClose={onClose} onSave={onSave} />}
    </div>
  );
}

// A device's small menu: Keyboard and Mouse ticks and its note (saved when the box loses focus).
function DeviceMenu({ device: d, n, below, right, onClose, onSave }: { device: Device; n: number; below: boolean; right: boolean; onClose: () => void; onSave: (patch: Parameters<typeof updateDevice>[1]) => void }) {
  const work = useCan("work");
  const [note, setNote] = useState(d.note ?? "");
  const ref = useRef<HTMLDivElement>(null);
  // A tap outside closes the menu before the note box loses focus, so a changed note is saved as
  // the menu goes.
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
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [onClose]);
  const tick = "flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-sm font-medium text-fg hover:bg-raised";
  return (
    <div
      ref={ref}
      className={`absolute w-56 rounded-xl border border-line-strong bg-surface p-2 shadow-[0_12px_32px_rgba(0,0,0,0.5)] ${below ? "top-6" : "bottom-6"} ${right ? "right-0" : "-left-6"}`}
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-bold tracking-wide text-subtle uppercase">Device {n}</span>
        <button type="button" onClick={onClose} className="press flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:text-fg" aria-label="Close">
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
          placeholder={work ? "This device's note…" : "No note"}
          className="input mt-0.5 block w-full resize-y py-1.5 text-sm"
        />
      </label>
    </div>
  );
}
