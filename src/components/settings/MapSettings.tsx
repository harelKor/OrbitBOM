"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { renameLocation } from "@/app/(app)/settings/actions";
import {
  addSpot,
  createZone,
  deleteSpot,
  deleteZone,
  setSystemDrawer,
  setZoneImage,
  startZoneImageUpload,
  updateSpot,
  updateZone,
  type MapResult,
} from "@/app/(app)/settings/mapActions";
import { LocationPicker, PlaceTag } from "@/components/inventory/LocationPicker";
import { MAP_H, MAP_W, WORKSHOP_ROOMS } from "@/config/workshopMap";
import { STATUSES } from "@/config/statuses";
import { SPOT_KINDS, ZONE_COLORS, bounds, centroid, kindLabel, spotsOf, zoneColor, type MapPoint, type Place, type SpotKind } from "@/lib/inventory/places";

// Settings → Map (Harel, 2026-11-14): draw the zones on the floor plan, give each its
// first-person picture and pin its drawers / shelves on it, and choose each system's drawer for
// its parts in each status. Everything saves at once.

export type DrawerSystem = { id: string; name: string; robot: string; drawers: Record<string, string> };

// Made parts wait in drawers from Ready for QA on (Harel, 2026-11-14).
const DRAWER_STATUSES = STATUSES.slice(STATUSES.findIndex((s) => s.name === "Ready for QA")).map((s) => s.name);

type View = { x: number; y: number; w: number };
const ASPECT = MAP_H / MAP_W;

function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<MapResult | void>, then?: (r: MapResult) => void) =>
    start(async () => {
      const r = (await fn()) ?? {};
      setError(r.error ?? null);
      if (!r.error) then?.(r);
    });
  return { run, pending, error };
}

// The picture shrunk in the browser: longest side 2000 px, WebP (JPEG where WebP can't be written).
async function shrink(file: File): Promise<{ blob: Blob; w: number; h: number; ext: "webp" | "jpg" }> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("That file isn't a picture this browser can open.");
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const as = (type: string) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.85));
  const webp = await as("image/webp");
  if (webp?.type === "image/webp") return { blob: webp, w: canvas.width, h: canvas.height, ext: "webp" };
  const jpg = await as("image/jpeg");
  if (!jpg) throw new Error("Couldn't read the picture.");
  return { blob: jpg, w: canvas.width, h: canvas.height, ext: "jpg" };
}

export function MapSettings({ places, systems }: { places: Place[]; systems: DrawerSystem[] }) {
  const zones = places.filter((p) => !p.parentId);
  const [selId, setSelId] = useState<string | null>(zones[0]?.id ?? null);
  const sel = zones.find((z) => z.id === selId) ?? null;
  const { run, pending, error } = useRun();
  return (
    <div className="min-w-0 space-y-4">
      <p className="max-w-3xl text-sm text-muted">
        Draw each zone on the floor plan, add a picture of it from where a person stands, and tap the picture to pin its drawers and shelves. Items are linked to a zone or a drawer; the map never shows the names below, Claude&apos;s tools and search use them.
      </p>
      {error && <p className="rounded-md bg-rose-500/10 p-2 text-sm text-rose-600">{error}</p>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ZoneEditor zones={zones} selId={selId} onSelect={setSelId} run={run} pending={pending} />
        <div className="space-y-3">
          {sel ? <ZonePanel key={sel.id} zone={sel} places={places} run={run} onDeleted={() => setSelId(null)} /> : <p className="panel p-4 text-sm text-muted">Tap a zone on the floor plan, or draw a new one.</p>}
        </div>
      </div>
      <SystemDrawers places={places} systems={systems} run={run} />
    </div>
  );
}

// ---------- The floor plan: draw, select, reshape ----------

function ZoneEditor({ zones, selId, onSelect, run, pending }: { zones: Place[]; selId: string | null; onSelect: (id: string | null) => void; run: ReturnType<typeof useRun>["run"]; pending: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, w: MAP_W });
  const [drawing, setDrawing] = useState<MapPoint[] | null>(null);
  const [hoverPt, setHoverPt] = useState<MapPoint | null>(null);
  // Corners being dragged, shown until the saved outline comes back.
  // Kept against the outline it was dragged from, so the saved one replaces it when it arrives.
  const [moved, setMoved] = useState<Record<string, { from: MapPoint[] | null | undefined; pts: MapPoint[] }>>({});
  const drag = useRef<{ kind: "pan" | "corner" | "zone"; zone?: string; index?: number; last: MapPoint; travel: number; start: { x: number; y: number }; target: string | null } | null>(null);
  const outlineOf = (z: Place) => (moved[z.id] && moved[z.id].from === z.outline ? moved[z.id].pts : (z.outline ?? null));

  const toMap = (cx: number, cy: number): MapPoint => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return [0, 0];
    const p = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  };
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [mx, my] = toMap(e.clientX, e.clientY);
      setView((v) => {
        const w = Math.min(MAP_W, Math.max(80, v.w * Math.exp(e.deltaY * 0.0015)));
        const r = w / v.w;
        return { w, x: mx - (mx - v.x) * r, y: my - (my - v.y) * r };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const k = view.w / 900; // map units per screen pixel, about
  const finish = () => {
    if (!drawing || drawing.length < 3) return;
    const outline = drawing;
    setDrawing(null);
    const target = zones.find((z) => z.id === selId && !z.outline?.length);
    if (target) run(() => updateZone(target.id, { outline }));
    else run(() => createZone(outline), (r) => r.id && onSelect(r.id));
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const t = e.target as Element;
    const corner = t.closest("[data-corner]")?.getAttribute("data-corner");
    const zoneId = t.closest("[data-zone]")?.getAttribute("data-zone") ?? null;
    const p = toMap(e.clientX, e.clientY);
    if (corner) {
      const [zid, i] = corner.split(":");
      drag.current = { kind: "corner", zone: zid, index: Number(i), last: p, travel: 0, start: { x: e.clientX, y: e.clientY }, target: zid };
    } else if (zoneId && zoneId === selId && !drawing) {
      drag.current = { kind: "zone", zone: zoneId, last: p, travel: 0, start: { x: e.clientX, y: e.clientY }, target: zoneId };
    } else {
      drag.current = { kind: "pan", last: p, travel: 0, start: { x: e.clientX, y: e.clientY }, target: zoneId };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toMap(e.clientX, e.clientY);
    if (drawing) setHoverPt(p);
    const d = drag.current;
    if (!d) return;
    d.travel = Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y);
    if (d.travel < 4) return;
    if (d.kind === "pan") {
      setView((v) => ({ ...v, x: v.x - (p[0] - d.last[0]), y: v.y - (p[1] - d.last[1]) }));
      return; // the view moved under the pointer, so `last` stays in map units
    }
    const z = zones.find((x) => x.id === d.zone);
    const pts = z && outlineOf(z);
    if (!pts) return;
    const next = d.kind === "corner" ? pts.map((q, i) => (i === d.index ? p : q)) : pts.map(([x, y]) => [x + p[0] - d.last[0], y + p[1] - d.last[1]] as MapPoint);
    setMoved((m) => ({ ...m, [z!.id]: { from: z!.outline, pts: next } }));
    d.last = p;
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.travel < 4) {
      if (drawing) {
        const p = toMap(e.clientX, e.clientY);
        // Tapping the first corner again closes the shape.
        if (drawing.length >= 3 && Math.hypot(p[0] - drawing[0][0], p[1] - drawing[0][1]) < 10 * k) finish();
        else setDrawing([...drawing, p]);
      } else onSelect(d.target);
      return;
    }
    if ((d.kind === "corner" || d.kind === "zone") && d.zone && moved[d.zone]) {
      const outline = moved[d.zone].pts;
      run(() => updateZone(d.zone!, { outline }));
    }
  };

  const unplaced = zones.filter((z) => !z.outline?.length);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {drawing ? (
          <>
            <span className="text-sm text-muted">Tap the corners of the zone{drawing.length >= 3 ? ", then Finish (or tap the first corner)" : ""}.</span>
            <button type="button" className="btn min-h-9 text-xs" disabled={drawing.length < 3 || pending} onClick={finish}>
              Finish
            </button>
            <button type="button" className="btn min-h-9 text-xs" onClick={() => setDrawing(drawing.slice(0, -1))} disabled={!drawing.length}>
              Undo corner
            </button>
            <button type="button" className="btn min-h-9 text-xs" onClick={() => setDrawing(null)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn min-h-9 text-xs active:scale-[0.98]" onClick={() => setDrawing([])}>
              + Draw a zone
            </button>
            <span className="text-xs text-muted">Drag to pan, scroll to zoom. Drag a picked zone or its corners to reshape it.</span>
          </>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#070B14]">
        <svg
          ref={svg}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.w * ASPECT}`}
          className={`block aspect-[1000/560] w-full touch-none select-none ${drawing ? "cursor-crosshair" : "cursor-grab"}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => (drag.current = null)}
        >
          {WORKSHOP_ROOMS.map((r) => (
            <g key={r.id}>
              <polygon points={r.points} fill="#1B2536" stroke="rgba(226,232,240,0.5)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              <text x={r.labelPos[0]} y={r.labelPos[1]} fontSize={r.labelSize} textAnchor="middle" dominantBaseline="middle" fill="#CBD5E1" opacity={0.35} style={{ direction: "rtl" }}>
                {r.label}
              </text>
            </g>
          ))}
          {zones.map((z, i) => {
            const pts = outlineOf(z);
            if (!pts?.length) return null;
            const on = z.id === selId;
            const color = zoneColor(z, i);
            const [cx, cy] = centroid(pts);
            const b = bounds(pts);
            const arrow = Math.max(12, Math.min(b.w, b.h) * 0.4);
            const rad = ((z.facing ?? 0) * Math.PI) / 180;
            return (
              <g key={z.id} data-zone={z.id} className={on ? "cursor-move" : "cursor-pointer"}>
                <polygon points={pts.map((p) => p.join(",")).join(" ")} fill={color} fillOpacity={on ? 0.35 : 0.18} stroke={color} strokeWidth={on ? 3 : 1.6} vectorEffect="non-scaling-stroke" />
                <text x={cx} y={cy} fontSize={11 * k} textAnchor="middle" dominantBaseline="middle" fill="#F8FAFC" pointerEvents="none">
                  {z.name}
                </text>
                {on && z.imageUrl && (
                  // Which way the picture looks.
                  <line x1={cx} y1={cy} x2={cx + Math.sin(rad) * arrow} y2={cy - Math.cos(rad) * arrow} stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" markerEnd="url(#ms-arrow)" pointerEvents="none" />
                )}
                {on &&
                  pts.map(([x, y], j) => (
                    <circle key={j} data-corner={`${z.id}:${j}`} cx={x} cy={y} r={6 * k} fill="#fff" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" className="cursor-pointer" />
                  ))}
              </g>
            );
          })}
          <defs>
            <marker id="ms-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0 0 10 5 0 10z" fill="#fff" />
            </marker>
          </defs>
          {drawing && (
            <g pointerEvents="none">
              <polyline points={[...drawing, ...(hoverPt ? [hoverPt] : [])].map((p) => p.join(",")).join(" ")} fill="rgba(56,189,248,0.15)" stroke="#38BDF8" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
              {drawing.map(([x, y], j) => (
                <circle key={j} cx={x} cy={y} r={(j === 0 ? 6 : 4) * k} fill={j === 0 ? "#38BDF8" : "#fff"} />
              ))}
            </g>
          )}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {zones.map((z, i) => (
          <button
            key={z.id}
            type="button"
            onClick={() => onSelect(z.id)}
            aria-pressed={z.id === selId}
            className={`press flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold active:scale-[0.98] ${z.id === selId ? "border-accent bg-accent/10 text-fg" : "border-line-strong text-fg-2"}`}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: zoneColor(z, i) }} />
            {z.name}
            {!z.outline?.length && <span className="text-rose-500">· not drawn</span>}
          </button>
        ))}
      </div>
      {unplaced.length > 0 && <p className="text-xs text-muted">A zone marked “not drawn” isn&apos;t on the map yet: pick it, then Draw a zone to give it its outline.</p>}
    </div>
  );
}

// ---------- One zone: name, colour, picture, direction, drawers ----------

function ZonePanel({ zone, places, run, onDeleted }: { zone: Place; places: Place[]; run: ReturnType<typeof useRun>["run"]; onDeleted: () => void }) {
  const spots = spotsOf(zone.id, places);
  const [name, setName] = useState(zone.name);
  const [kind, setKind] = useState<SpotKind>("drawer");
  const [spotSel, setSpotSel] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [facing, setFacing] = useState(zone.facing ?? 0);
  const file = useRef<HTMLInputElement>(null);
  const picture = useRef<HTMLDivElement>(null);
  // Dragged dots, kept until the saved places arrive.
  const [moving, setMovingState] = useState<{ from: Place[]; at: Record<string, { x: number; y: number }> }>({ from: places, at: {} });
  const movingAt = moving.from === places ? moving.at : {};
  const setMoving = (f: (m: Record<string, { x: number; y: number }>) => Record<string, { x: number; y: number }>) => setMovingState({ from: places, at: f(movingAt) });
  const drag = useRef<{ id: string | null; travel: number; sx: number; sy: number } | null>(null);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    setUploadError(null);
    try {
      const img = await shrink(f);
      const start = await startZoneImageUpload(img.ext);
      if ("error" in start) throw new Error(start.error);
      const res = await fetch(start.url, { method: "PUT", body: img.blob }).catch(() => null);
      if (!res?.ok) throw new Error("The upload failed. Check your connection and try again.");
      setPreview(URL.createObjectURL(img.blob));
      run(() => setZoneImage(zone.id, start.key, { w: img.w, h: img.h }));
    } catch (e) {
      setUploadError((e as Error).message);
    }
    setUploading(false);
  };

  const at = (e: React.PointerEvent) => {
    const r = picture.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const id = (e.target as Element).closest("[data-spot]")?.getAttribute("data-spot") ?? null;
    drag.current = { id, travel: 0, sx: e.clientX, sy: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.travel = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
    if (d.travel >= 4 && d.id) setMoving((m) => ({ ...m, [d.id!]: at(e) }));
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.travel < 4) {
      if (d.id) setSpotSel(d.id === spotSel ? null : d.id);
      else {
        const p = at(e);
        run(() => addSpot(zone.id, p, kind), (r) => r.id && setSpotSel(r.id));
      }
      return;
    }
    if (d.id && movingAt[d.id]) {
      const p = movingAt[d.id];
      run(() => updateSpot(d.id!, p));
    }
  };
  const image = preview ?? zone.imageUrl;
  const picked = spots.find((s) => s.id === spotSel);

  return (
    <div className="panel space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== zone.name && run(() => renameLocation(zone.id, name))}
          aria-label="Zone name (hidden on the map)"
          className="input min-h-9 w-48 text-sm"
        />
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Colour">
          {ZONE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={zone.color === c}
              aria-label={c}
              onClick={() => run(() => updateZone(zone.id, { color: c }))}
              className={`h-6 w-6 rounded-full border-2 active:scale-[0.95] ${zone.color === c ? "border-fg" : "border-transparent"}`}
              style={{ background: c }}
            />
          ))}
        </div>
        <span className="flex-1" />
        <button
          type="button"
          className="btn min-h-9 text-xs text-rose-600"
          onClick={() => {
            if (confirm(`Delete ${zone.name} and its ${spots.length} drawers? Their items stay, without a place.`)) run(() => deleteZone(zone.id), onDeleted);
          }}
        >
          Delete zone
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" className="btn min-h-9 text-xs" disabled={uploading} onClick={() => file.current?.click()}>
          {uploading ? "Uploading…" : image ? "Replace picture" : "Add picture"}
        </button>
        {image && (
          <button type="button" className="btn min-h-9 text-xs" onClick={() => { if (confirm("Remove this zone's picture? Its drawers stay pinned for the next one.")) { setPreview(null); run(() => setZoneImage(zone.id, null)); } }}>
            Remove picture
          </button>
        )}
        {image && (
          <label className="flex items-center gap-2 text-xs text-muted">
            Looks
            <input
              type="range"
              min={0}
              max={359}
              step={5}
              value={facing}
              onChange={(e) => setFacing(Number(e.target.value))}
              onPointerUp={() => run(() => updateZone(zone.id, { facing }))}
              onKeyUp={() => run(() => updateZone(zone.id, { facing }))}
              className="w-28"
              aria-label="Which way the picture looks on the floor plan"
            />
            <span className="w-8 tabular-nums">{facing}°</span>
          </label>
        )}
        {uploadError && <span className="text-xs text-rose-600">{uploadError}</span>}
      </div>

      {image ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">Tap the picture to add a</span>
            {SPOT_KINDS.map((s) => (
              <button key={s.id} type="button" aria-pressed={kind === s.id} onClick={() => setKind(s.id)} className={`press min-h-8 rounded-full border px-2.5 font-semibold ${kind === s.id ? "border-accent bg-accent text-white" : "border-line-strong text-fg-2"}`}>
                {s.label}
              </button>
            ))}
            <span className="text-muted">· drag a dot to move it</span>
          </div>
          <div ref={picture} className="relative inline-block max-w-full touch-none overflow-hidden rounded-lg align-top select-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed R2 link or a local preview */}
            <img src={image} alt="" className="block max-h-[55vh] w-auto max-w-full" draggable={false} />
            {spots.map((s) => {
              const p = movingAt[s.id] ?? { x: s.spotX ?? 0.5, y: s.spotY ?? 0.5 };
              const on = s.id === spotSel;
              return (
                <span
                  key={s.id}
                  data-spot={s.id}
                  title={s.name}
                  className={`absolute flex -translate-x-1/2 -translate-y-1/2 cursor-move items-center justify-center rounded-full border-[3px] text-[0.625rem] font-bold shadow-[0_2px_8px_rgba(0,0,0,0.5)] ${on ? "h-8 w-8 border-white text-white" : "h-6 w-6 bg-white text-slate-900"}`}
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, borderColor: on ? "#fff" : zoneColor(zone), background: on ? zoneColor(zone) : undefined }}
                >
                  {kindLabel(s.kind)[0]}
                </span>
              );
            })}
          </div>
          {picked && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 text-xs">
              <span className="font-semibold">{picked.name}</span>
              <span className="flex-1" />
              {SPOT_KINDS.map((s) => (
                <button key={s.id} type="button" aria-pressed={picked.kind === s.id} onClick={() => run(() => updateSpot(picked.id, { kind: s.id }))} className={`press min-h-8 rounded-full border px-2.5 font-semibold ${picked.kind === s.id ? "border-accent bg-accent text-white" : "border-line-strong text-fg-2"}`}>
                  {s.label}
                </button>
              ))}
              <button type="button" className="btn min-h-8 text-xs text-rose-600" onClick={() => run(() => deleteSpot(picked.id), () => setSpotSel(null))}>
                Delete
              </button>
            </div>
          )}
          <p className="text-xs text-muted">{spots.length} drawers and shelves. A deleted one&apos;s items stay in the zone.</p>
        </>
      ) : (
        <p className="text-sm text-muted">Add a picture of this zone taken from where you&apos;d stand (landscape works best). Then pin its drawers and shelves on it.</p>
      )}
    </div>
  );
}

// ---------- Each system's drawers by status ----------

function SystemDrawers({ places, systems, run }: { places: Place[]; systems: DrawerSystem[]; run: ReturnType<typeof useRun>["run"] }) {
  if (!systems.length) return null;
  return (
    <div className="min-w-0 space-y-2">
      <h2 className="text-lg font-semibold">System drawers</h2>
      <p className="max-w-3xl text-sm text-muted">Where each system&apos;s made parts wait, by status. A part in that status shows the map icon that flies to its drawer.</p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="p-2">System</th>
              {DRAWER_STATUSES.map((s) => (
                <th key={s} className="p-2 whitespace-nowrap">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {systems.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <td className="p-2 whitespace-nowrap">
                  <span className="text-muted">{s.robot} · </span>
                  {s.name}
                </td>
                {DRAWER_STATUSES.map((status) => {
                  const placeId = s.drawers[status] ?? null;
                  const place = places.find((p) => p.id === placeId);
                  return (
                    <td key={status} className="p-1.5">
                      <LocationPicker
                        locations={places}
                        value={place ? placeId : null}
                        onChange={(id) => run(() => setSystemDrawer(s.id, status, id))}
                        className="press flex min-h-9 items-center gap-1 rounded-lg border border-line px-2 text-xs whitespace-nowrap hover:border-accent active:scale-[0.98]"
                      >
                        {place ? <PlaceTag place={place} places={places} /> : <span className="text-subtle">—</span>}
                      </LocationPicker>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
