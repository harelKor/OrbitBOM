"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { saveBatchLayout } from "@/app/(app)/groups/actions";
import { Dialog } from "@/components/Dialog";
import type { BatchLayout } from "@/lib/fab/batchLayout";
import {
  DEFAULT_GAP,
  DEFAULT_MARGIN,
  advisePlate,
  cornerOf,
  footprint,
  layoutBox,
  nestParts,
  placePoint,
  type FlatPart,
  type Placement,
  type Pt,
  type Rotation,
} from "@/lib/fab/layout";
import { OnshapeLayoutButton } from "./OnshapeLayoutButton";

// The sheet the parts are nested on: the advisor's pick, one stock piece, or a width typed in.
type Sheet = { kind: "auto" } | { kind: "piece"; size: string } | { kind: "custom"; w: number };

const mm = (n: number) => `${Math.round(n)}`;
const keyOf = (p: { partId: string; copy: number }) => `${p.partId}#${p.copy}`;
// Every part in one CAD grey (Harel, 2026-10-31); the selected copy gets a bright outline.
const GREY = { stroke: "#94a3b8", fill: "rgba(148,163,184,0.18)", on: "#60a5fa", onFill: "rgba(96,165,250,0.22)", clash: "#F43F5E" };

const sheetKeyOf = (s: Sheet) => (s.kind === "piece" ? s.size : s.kind === "custom" ? `custom:${Math.round(s.w)}` : "auto");
function sheetFrom(key: string | undefined): Sheet {
  if (!key || key === "auto") return { kind: "auto" };
  if (key.startsWith("custom:")) return { kind: "custom", w: Math.max(50, Number(key.slice(7)) || 600) };
  return { kind: "piece", size: key };
}
// Turns kept between -180 and 180, rounded to a tenth of a degree.
const normDeg = (d: number) => Math.round((((d % 360) + 540) % 360 - 180) * 10) / 10;

// Auto Layout (Harel, 2026-10-31): the batch's parts laid flat, pockets up, nested on the
// smallest plate on the shelf that takes them. Drag a copy to move it; ←/→ turn it 5° (Shift 1°),
// R or double-click 90°. The layout is worked out from the 3D shapes already saved (no Onshape
// calls), and every change is saved on the batch, so reopening shows the same layout.
export function BatchLayoutDialog({ groupId, name, open, onClose }: { groupId: string; name: string; open: boolean; onClose: () => void }) {
  const [data, setData] = useState<BatchLayout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gap, setGapRaw] = useState(DEFAULT_GAP);
  const [margin, setMarginRaw] = useState(DEFAULT_MARGIN);
  const [sheet, setSheetRaw] = useState<Sheet>({ kind: "auto" });
  const [selected, setSelected] = useState<string | null>(null);
  // Copies moved or turned by hand (or restored from the last visit), until the next re-nest.
  const [edited, setEdited] = useState<Placement[] | null>(null);
  // While Onshape Layout runs, the layout stays as it is.
  const [busy, setBusy] = useState(false);
  const [onshapeUrl, setOnshapeUrl] = useState<string | null>(null);
  // Set by the member's own changes; only then is the layout saved.
  const dirty = useRef(false);
  const touch = () => (dirty.current = true);
  // A new gap, margin or sheet nests afresh.
  const setGap = (n: number) => (touch(), setEdited(null), setGapRaw(n));
  const setMargin = (n: number) => (touch(), setEdited(null), setMarginRaw(n));
  const setSheet = (s: Sheet) => (touch(), setEdited(null), setSheetRaw(s));

  useEffect(() => {
    if (!open || data) return;
    let live = true;
    fetch(`/api/groups/${groupId}/layout`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({ error: "The layout didn't load." }));
        if (!live) return;
        if (!res.ok) setError(body.error ?? "The layout didn't load.");
        else {
          const loaded = body as BatchLayout;
          setData(loaded);
          const saved = loaded.saved;
          setOnshapeUrl(saved?.onshape?.url ?? null);
          if (saved?.gap != null) setGapRaw(saved.gap);
          if (saved?.margin != null) setMarginRaw(saved.margin);
          if (saved?.sheetKey) setSheetRaw(sheetFrom(saved.sheetKey));
          // The saved positions, when they still cover exactly the batch's copies.
          const want = new Set(loaded.parts.flatMap((p) => Array.from({ length: p.quantity }, (_, copy) => keyOf({ partId: p.partId, copy }))));
          const list = saved?.placements ?? [];
          if (list.length === want.size && list.every((p) => want.has(keyOf(p)))) setEdited(list);
        }
      })
      .catch(() => live && setError("The layout didn't load."));
    return () => {
      live = false;
    };
  }, [open, data, groupId]);

  const parts = useMemo(() => data?.parts ?? [], [data]);
  const byId = useMemo(() => new Map(parts.map((p) => [p.partId, p])), [parts]);
  const pieces = useMemo(() => data?.stock?.pieces ?? [], [data]);

  // Re-nest whenever the gap, margin or sheet changes; the advisor reruns on the shelf's pieces.
  const nested = useMemo(() => {
    if (!data) return null;
    const advised = advisePlate(parts, pieces, gap, margin);
    if (sheet.kind === "auto") return { ...advised, sheetW: advised.advice.sheetW, sheetH: advised.advice.piece ? advised.advice.sheetH : 0 };
    if (sheet.kind === "piece") {
      const piece = pieces.find((p) => p.size === sheet.size);
      if (piece) {
        const [w, h] = [Math.max(piece.x, piece.y), Math.min(piece.x, piece.y)];
        const wide = nestParts(parts, { sheetW: w, sheetH: h, gap, margin });
        const tall = nestParts(parts, { sheetW: h, sheetH: w, gap, margin });
        const pick = tall.unplaced.length < wide.unplaced.length ? { nest: tall, w: h, h: w } : { nest: wide, w, h };
        return { advice: advised.advice, nest: pick.nest, sheetW: pick.w, sheetH: pick.h };
      }
    }
    const w = sheet.kind === "custom" ? sheet.w : advised.advice.sheetW;
    return { advice: advised.advice, nest: nestParts(parts, { sheetW: w, gap, margin }), sheetW: w, sheetH: 0 };
  }, [data, parts, pieces, gap, margin, sheet]);

  const nest = nested?.nest;
  const placements = useMemo(() => edited ?? nest?.placements ?? [], [edited, nest]);
  const setPlacements = (change: (all: Placement[]) => Placement[]) => {
    if (busy) return;
    touch();
    setEdited((prev) => change(prev ?? nest?.placements ?? []));
  };

  // Saved a moment after the last change (and at once before Onshape Layout runs).
  const sheetKey = sheetKeyOf(sheet);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = () => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
    if (!dirty.current || !data) return Promise.resolve();
    dirty.current = false;
    return saveBatchLayout(groupId, { gap, margin, sheetKey, placements }).then(() => undefined);
  };
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (!dirty.current) return;
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void saveRef.current(), 700);
  }, [placements, gap, margin, sheetKey]);
  // Closing the window saves what's waiting.
  useEffect(() => () => void saveRef.current(), []);

  const advice = nested?.advice;
  const box = layoutBox(parts, placements);
  const boxW = box.x1 - box.x0;
  const boxH = box.y1 - box.y0;
  const sheetW = nested?.sheetW ?? 0;
  const sheetH = nested?.sheetH || box.y1 + margin;
  const shownPiece = sheet.kind === "piece" ? pieces.find((p) => p.size === sheet.size) : sheet.kind === "auto" ? advice?.piece : null;

  // Copies off the sheet or closer than the gap to another copy.
  const clashes = useMemo(() => {
    const rects = placements.flatMap((p) => {
      const part = byId.get(p.partId);
      if (!part) return [];
      const [x, y] = cornerOf(part, p);
      const [w, h] = footprint(part, p.rotation);
      return [{ k: keyOf(p), x, y, w, h }];
    });
    const bad = new Set<string>();
    for (const r of rects) if (r.x < -0.01 || r.y < -0.01 || r.x + r.w > sheetW + 0.01 || (nested?.sheetH && r.y + r.h > sheetH + 0.01)) bad.add(r.k);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const [a, b] = [rects[i], rects[j]];
        const g = gap - 0.01;
        if (a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g) {
          bad.add(a.k);
          bad.add(b.k);
        }
      }
    return bad;
  }, [placements, byId, sheetW, sheetH, gap, nested?.sheetH]);

  // Turns a copy about its own centre, so it stays where it was.
  const rotate = (k: string, by = 90) =>
    setPlacements((all) =>
      all.map((p) => {
        if (keyOf(p) !== k) return p;
        const part = byId.get(p.partId)!;
        const mid: Pt = [part.w / 2, part.h / 2];
        const [cx, cy] = placePoint(mid, p);
        const rotation: Rotation = normDeg(p.rotation + by);
        const [mx, my] = placePoint(mid, { x: 0, y: 0, rotation });
        return { ...p, x: cx - mx, y: cy - my, rotation };
      }),
    );

  useEffect(() => {
    if (!open || !selected || busy) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      if (e.key === "r" || e.key === "R") rotate(selected);
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 5;
        rotate(selected, e.key === "ArrowLeft" ? -step : step);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const total = parts.reduce((t, p) => t + p.quantity, 0);
  const field = "w-16 rounded-md border border-line-strong bg-surface px-2 py-1 text-right font-mono text-xs tabular-nums focus:border-sky-400 focus:outline-none";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="w-[min(64rem,calc(100vw-2rem))]"
      sheet
      title={<span>Auto Layout · {name}</span>}
      actions={
        data && (
          <OnshapeLayoutButton
            groupId={groupId}
            placements={placements}
            url={onshapeUrl}
            where="dialog"
            onBusy={(on) => {
              if (on) {
                void save();
                setSelected(null);
              }
              setBusy(on);
            }}
            onDone={(url) => setOnshapeUrl(url)}
          />
        )
      }
    >
      {error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : !data || !nested ? (
        <p className="text-sm text-muted">Laying the parts flat…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <fieldset disabled={busy} className="flex flex-wrap items-end gap-3 text-xs disabled:opacity-60">
            <label className="flex flex-col gap-1">
              <span className="text-muted">Gap</span>
              <span className="flex items-center gap-1">
                <input type="number" min={0} max={100} value={gap} onChange={(e) => setGap(Math.max(0, Number(e.target.value) || 0))} className={field} />
                mm
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">Margin</span>
              <span className="flex items-center gap-1">
                <input type="number" min={0} max={100} value={margin} onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))} className={field} />
                mm
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">Sheet</span>
              <select
                value={sheet.kind === "piece" ? sheet.size : sheet.kind}
                onChange={(e) => {
                  const v = e.target.value;
                  setSheet(v === "auto" ? { kind: "auto" } : v === "custom" ? { kind: "custom", w: Math.round(sheetW) || 600 } : { kind: "piece", size: v });
                }}
                className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs focus:border-sky-400 focus:outline-none"
              >
                <option value="auto">Best from the shelf</option>
                {advice?.pieces.map((p) => (
                  <option key={p.size} value={p.size}>
                    {p.label} {p.share && `(${p.share})`} · {p.count} in stock{p.fits ? "" : " · too small"}
                  </option>
                ))}
                <option value="custom">Custom width…</option>
              </select>
            </label>
            {sheet.kind === "custom" && (
              <label className="flex flex-col gap-1">
                <span className="text-muted">Width</span>
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    min={50}
                    max={5000}
                    value={sheet.w}
                    onChange={(e) => setSheet({ kind: "custom", w: Math.max(50, Number(e.target.value) || 50) })}
                    className={field}
                  />
                  mm
                </span>
              </label>
            )}
            <button className="press rounded-md border border-line-strong px-2.5 py-1 font-semibold text-fg-2 hover:border-sky-400/60 hover:text-sky-500 active:scale-[0.98]" onClick={() => (touch(), setEdited(null))}>
              Re-nest
            </button>
            <div className="ml-auto text-right">
              <div className="text-muted">Nested size</div>
              <div className="font-mono text-lg font-bold tabular-nums text-fg">
                {mm(boxW)}mm × {mm(boxH)}mm
              </div>
            </div>
          </fieldset>

          <Advisor data={data} advice={advice!} />

          {parts.length > 0 ? (
            <SheetPreview
              parts={byId}
              placements={placements}
              setPlacements={setPlacements}
              selected={selected}
              setSelected={setSelected}
              rotate={rotate}
              clashes={clashes}
              sheetW={sheetW}
              sheetH={sheetH}
              pieceLabel={shownPiece ? `${shownPiece.label}${shownPiece.share ? ` (${shownPiece.share})` : ""}` : null}
              locked={busy}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-muted">No part in this batch has a saved 3D shape yet.</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span>
              <span className="font-mono tabular-nums text-fg">{placements.length}</span>/<span className="font-mono tabular-nums">{total}</span> copies placed
            </span>
            {nested.nest.unplaced.length > 0 && <span className="text-amber-500">{nested.nest.unplaced.length} don&apos;t fit on this sheet</span>}
            {clashes.size > 0 && <span className="text-rose-500">{clashes.size} too close or off the sheet</span>}
            <span>Drag to move · ←/→ rotates 5° (Shift 1°) · R or double-click turns 90°</span>
            {selected && !busy && (
              <span className="flex items-center gap-1">
                <span className="font-mono tabular-nums text-fg">{placements.find((p) => keyOf(p) === selected)?.rotation ?? 0}°</span>
                <button className="press rounded-md border border-line-strong px-2 py-0.5 font-semibold text-fg-2 hover:border-sky-400/60 active:scale-[0.98]" onClick={() => rotate(selected)}>
                  Turn 90°
                </button>
              </span>
            )}
          </div>

          <PartList parts={parts} />
          {data.missing.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
              <div className="mb-1 font-semibold text-amber-600 dark:text-amber-400">Not in the layout</div>
              <ul className="flex flex-col gap-0.5">
                {data.missing.map((m) => (
                  <li key={m.partId}>
                    <span className="font-medium text-fg">{m.name}</span> <span className="text-muted">{m.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Advisor({ data, advice }: { data: BatchLayout; advice: ReturnType<typeof advisePlate>["advice"] }) {
  const where = data.stock?.location ? ` in 📍 ${data.stock.location}` : "";
  if (!data.stock) {
    return (
      <div className="rounded-lg border border-line bg-surface p-3 text-sm text-muted">
        {data.material ? (
          <>
            No inventory item is linked for <span className="font-medium text-fg">{data.material}</span>, so there&apos;s no stock plate to suggest.
          </>
        ) : (
          "These parts have no material, so there's no stock plate to suggest."
        )}
      </div>
    );
  }
  if (!data.stock.pieces.length) {
    return (
      <div className="rounded-lg border border-line bg-surface p-3 text-sm text-muted">
        <span className="font-medium text-fg">{data.stock.name}</span> has no plate sizes on the shelf (give it a size like 500×900 to get a suggestion).
      </div>
    );
  }
  if (advice.piece) {
    return (
      <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
        <span className="text-muted">Recommended stock on shelf: </span>
        <span className="font-mono font-bold tabular-nums text-amber-600 dark:text-amber-400">
          {advice.piece.label}mm{advice.piece.share && advice.piece.share !== "≈" ? ` (${advice.piece.share === "Full" ? "full sheet" : `${advice.piece.share} sheet`})` : ""}
        </span>
        <span className="text-muted">
          {" "}
          — <span className="font-mono tabular-nums">{advice.piece.count}</span> available{where} · {data.stock.name}
        </span>
      </div>
    );
  }
  const biggest = [...data.stock.pieces].filter((p) => p.count > 0).sort((a, b) => b.x * b.y - a.x * a.y)[0];
  return (
    <div className="rounded-lg border border-rose-500/50 bg-rose-500/10 p-3 text-sm">
      <span className="font-semibold text-rose-600 dark:text-rose-400">No single piece on the shelf fits all the parts.</span>{" "}
      {biggest && advice.sheetsNeeded > 0 ? (
        <span className="text-muted">
          It splits over <span className="font-mono tabular-nums text-fg">{advice.sheetsNeeded}</span> × {biggest.label}mm (
          <span className="font-mono tabular-nums">{biggest.count}</span> in stock{where}).
        </span>
      ) : biggest ? (
        <span className="text-muted">A part is bigger than the largest piece ({biggest.label}mm).</span>
      ) : (
        <span className="text-muted">{data.stock.name} is out of stock.</span>
      )}
    </div>
  );
}

function PartList({ parts }: { parts: FlatPart[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {parts.map((p) => (
        <span key={p.partId} className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5" title={p.plate ? undefined : "Not a flat plate: laid on its biggest face"}>
          <span className="h-2 w-2 rounded-full bg-slate-400" />
          <span className="max-w-[12rem] truncate font-medium">{p.name}</span>
          <span className="font-mono tabular-nums text-muted">×{p.quantity}</span>
          <span className="font-mono tabular-nums text-subtle">
            {mm(p.w)}×{mm(p.h)}×{p.thickness.toFixed(1)}
          </span>
          {!p.plate && <span className="text-amber-500">not flat</span>}
        </span>
      ))}
    </div>
  );
}

function SheetPreview({
  parts,
  placements,
  setPlacements,
  selected,
  setSelected,
  rotate,
  clashes,
  sheetW,
  sheetH,
  pieceLabel,
  locked,
}: {
  parts: Map<string, FlatPart>;
  placements: Placement[];
  setPlacements: (change: (all: Placement[]) => Placement[]) => void;
  selected: string | null;
  setSelected: (k: string | null) => void;
  rotate: (k: string) => void;
  clashes: Set<string>;
  sheetW: number;
  sheetH: number;
  pieceLabel: string | null;
  locked: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ k: string; start: Pt; from: Pt } | null>(null);
  const pad = Math.max(sheetW, sheetH) * 0.03 + 10;
  // Sheet Y runs up; the SVG's runs down, so points are drawn at (x, sheetH - y).
  const toSvg = (p: Pt): Pt => [p[0], sheetH - p[1]];
  const pointer = (e: React.PointerEvent): Pt => {
    const m = svg.current?.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, sheetH - p.y];
  };
  const path = (loop: Pt[], pl: Placement) =>
    loop
      .map((pt, i) => {
        const [x, y] = toSvg(placePoint(pt, pl));
        return `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ") + " Z";

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#07090E] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
      {locked && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#07090E]/60 backdrop-blur-[1px]">
          <span className="flex items-center gap-2 rounded-full border border-sky-400/40 bg-[#0D111A] px-4 py-2 text-sm font-semibold text-sky-300 shadow-[0_0_20px_rgba(56,189,248,0.25)]">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            Creating Onshape Layout…
          </span>
        </div>
      )}
      <svg
        ref={svg}
        viewBox={`${-pad} ${-pad} ${sheetW + 2 * pad} ${sheetH + 2 * pad}`}
        // Half the visible screen at most: a swipe on the sheet drags parts, so on a phone the window
        // needs room around it to scroll to the controls.
        className="block max-h-[50dvh] w-full touch-none select-none"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const [px, py] = pointer(e);
          const [dx, dy] = [Math.round(px - d.start[0]), Math.round(py - d.start[1])];
          setPlacements((all) => all.map((p) => (keyOf(p) === d.k ? { ...p, x: d.from[0] + dx, y: d.from[1] + dy } : p)));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <defs>
          <pattern id="sheet-grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M50 0H0V50" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect x={0} y={0} width={sheetW} height={sheetH} fill="#0D111A" stroke={pieceLabel ? "#F59E0B" : "rgba(56,189,248,0.5)"} strokeWidth={Math.max(1.5, sheetW / 400)} strokeDasharray={pieceLabel ? undefined : "8 6"} />
        <rect x={0} y={0} width={sheetW} height={sheetH} fill="url(#sheet-grid)" pointerEvents="none" />
        {pieceLabel && (
          <text x={4} y={-pad / 3} fill="#F59E0B" fontSize={Math.max(10, sheetW / 45)} fontFamily="ui-monospace, monospace" fontWeight={700}>
            {pieceLabel}
          </text>
        )}
        {placements.map((pl) => {
          const part = parts.get(pl.partId);
          if (!part) return null;
          const k = keyOf(pl);
          const on = selected === k;
          const clash = clashes.has(k);
          const stroke = clash ? GREY.clash : on ? GREY.on : GREY.stroke;
          const fill = clash ? "rgba(244,63,94,0.18)" : on ? GREY.onFill : GREY.fill;
          const [cx, cy] = cornerOf(part, pl);
          const [fw, fh] = footprint(part, pl.rotation);
          const [lx, ly] = toSvg([cx + fw / 2, cy + fh / 2]);
          return (
            <g
              key={k}
              className="cursor-grab active:cursor-grabbing"
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture?.(e.pointerId);
                setSelected(k);
                drag.current = { k, start: pointer(e), from: [pl.x, pl.y] };
              }}
              onDoubleClick={() => rotate(k)}
            >
              <title>{`${part.name} (${pl.copy + 1}/${part.quantity})`}</title>
              <path d={[part.outline, ...part.holes].map((l) => path(l, pl)).join(" ")} fillRule="evenodd" fill={fill} stroke={stroke} strokeWidth={on ? 2 : 1} vectorEffect="non-scaling-stroke" />
              {Math.min(fw, fh) > 30 && (
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fill="#E2E8F0" fontSize={Math.min(14, Math.min(fw, fh) / 4) + Math.max(0, sheetW / 120)} fontFamily="ui-monospace, monospace" pointerEvents="none">
                  {part.quantity > 1 ? `${pl.copy + 1}` : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
