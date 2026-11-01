"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// A table that handles like Google Sheets (Harel, 2026-10-28): it scrolls on its own both ways as
// one sheet (no pinned columns: on a phone they ate the screen) with the header row stuck to the
// top of its own box, Ctrl + wheel (or a trackpad or
// two-finger pinch) zooms it around the pointer, and dragging a header's right edge sizes that
// column (double-click the edge to fit it to its contents). Zoom and column widths are kept in
// this browser per table (`id`). The table inside must be a .data-table.

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.2;
const EDGE = 6; // px either side of a header's right edge that grab it (touch gets more)
const MIN_COL = 32;

const clampZoom = (z: number) => Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) * 1000) / 1000;

function load<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function save(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const headCells = (table: HTMLTableElement | null) =>
  Array.from(table?.tHead?.rows[0]?.cells ?? []) as HTMLTableCellElement[];

export function SheetViewport({
  id,
  className = "",
  children,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const zoom = useRef(1);
  const widths = useRef<number[] | null>(null);
  const [shownZoom, setShownZoom] = useState(1);
  const [sized, setSized] = useState(false);
  // The zoom pill shows while the pointer is over the table, or for 1.5 s after a zoom.
  const [flashing, setFlashing] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = () => {
    setFlashing(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashing(false), 1500);
  };
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const table = () => box.current?.querySelector<HTMLTableElement>("table.data-table") ?? null;
  const widthKey = (cols: number) => `orbit-sheet:${id}:cols:${cols}`;
  const zoomKey = `orbit-sheet:${id}:zoom`;

  // Fixed column widths (once the member has sized one) go on the header cells, and the table
  // switches to a fixed layout of exactly their sum, like a sheet.
  const applyWidths = useCallback(() => {
    const t = table();
    if (!t) return;
    const cells = headCells(t);
    const w = widths.current;
    if (w && w.length === cells.length) {
      cells.forEach((c, i) => (c.style.width = `${w[i]}px`));
      t.style.tableLayout = "fixed";
      t.style.width = `${w.reduce((a, b) => a + b, 0)}px`;
      box.current?.setAttribute("data-fixed", "");
    } else {
      cells.forEach((c) => (c.style.width = ""));
      t.style.tableLayout = "";
      t.style.width = "";
      box.current?.removeAttribute("data-fixed");
    }
  }, []);

  // Each column's natural width (what it takes with nothing set), for double-click to fit.
  const naturalWidths = () => {
    const t = table()!;
    const cells = headCells(t);
    const keep = widths.current;
    widths.current = null;
    applyWidths();
    t.style.width = "max-content";
    const out = cells.map((c) => Math.ceil(c.getBoundingClientRect().width / zoom.current));
    widths.current = keep;
    applyWidths();
    return out;
  };

  const setZoom = (next: number, anchor?: { x: number; y: number }) => {
    const el = box.current;
    const z = clampZoom(next);
    if (!el || z === zoom.current) return;
    const r = el.getBoundingClientRect();
    const ax = anchor ? anchor.x - r.left : el.clientWidth / 2;
    const ay = anchor ? anchor.y - r.top : 0;
    // Keep the spot under the pointer (or the middle of the view) where it is.
    const cx = (el.scrollLeft + ax) / zoom.current;
    const cy = (el.scrollTop + ay) / zoom.current;
    zoom.current = z;
    el.style.setProperty("--sheet-zoom", String(z));
    el.scrollLeft = cx * z - ax;
    el.scrollTop = cy * z - ay;
    setShownZoom(z);
    flash();
    save(zoomKey, z === 1 ? null : z);
  };

  // Saved zoom and widths, and keep widths right as rows and columns come and go.
  useLayoutEffect(() => {
    const z = load<number>(zoomKey);
    if (z) {
      zoom.current = clampZoom(z);
      box.current?.style.setProperty("--sheet-zoom", String(zoom.current));
      setShownZoom(zoom.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // Runs after every render on purpose (columns can change); setSized only moves on a new count.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const cols = headCells(table()).length;
    if (!widths.current || widths.current.length !== cols) {
      const saved = load<number[]>(widthKey(cols));
      widths.current = saved?.length === cols ? saved : null;
      setSized(!!widths.current);
    }
    applyWidths();
  });

  // Ctrl + wheel and pinches zoom the table, not the page or the card size.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const step = Math.max(-0.15, Math.min(0.15, -e.deltaY * (e.deltaMode === 1 ? 0.03 : 0.0025)));
      setZoom(zoom.current * (1 + step), { x: e.clientX, y: e.clientY });
    };
    let pinch: { dist: number; zoom: number } | null = null;
    const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) pinch = { dist: spread(e.touches), zoom: zoom.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      // Only a two-finger pinch is held back; one finger always scrolls (the page, at the edges).
      if (!pinch || e.touches.length < 2) return;
      e.preventDefault();
      const mid = {
        x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
      setZoom(pinch.zoom * (spread(e.touches) / pinch.dist), mid);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    // Safari's own pinch-to-zoom of the page.
    const stopGesture = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("gesturestart", stopGesture);
    el.addEventListener("gesturechange", stopGesture);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("gesturestart", stopGesture);
      el.removeEventListener("gesturechange", stopGesture);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The header edge under the pointer, if any.
  const edgeAt = (e: React.PointerEvent | React.MouseEvent) => {
    const th = (e.target as Element).closest("th");
    if (!th || !box.current?.contains(th)) return -1;
    const cells = headCells(table());
    const reach = "pointerType" in e && e.pointerType === "touch" ? EDGE * 2 : EDGE;
    for (let i = 0; i < cells.length; i++) {
      const right = cells[i].getBoundingClientRect().right;
      if (Math.abs(e.clientX - right) <= reach) return i;
    }
    return -1;
  };

  const drag = useRef<{ col: number; x: number; start: number[] } | null>(null);
  const justDragged = useRef(false);
  const lastPress = useRef<{ col: number; at: number } | null>(null);

  const commit = (w: number[] | null) => {
    widths.current = w;
    setSized(!!w);
    applyWidths();
    save(widthKey(headCells(table()).length), w);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const col = edgeAt(e);
    if (col < 0) return;
    e.preventDefault();
    // A second press on the same edge is a double-click: fit the column. (preventDefault above
    // keeps the browser from sending dblclick itself.)
    const now = e.timeStamp;
    if (lastPress.current && lastPress.current.col === col && now - lastPress.current.at < 400) {
      lastPress.current = null;
      fit(col);
      return;
    }
    lastPress.current = { col, at: now };
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = widths.current ?? naturalWidths();
    drag.current = { col, x: e.clientX, start };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = e.currentTarget;
    if (!d) {
      if (e.pointerType === "mouse") el.style.cursor = edgeAt(e) >= 0 ? "col-resize" : "";
      return;
    }
    const next = [...d.start];
    next[d.col] = Math.max(MIN_COL, Math.round(d.start[d.col] + (e.clientX - d.x) / zoom.current));
    widths.current = next;
    applyWidths();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    justDragged.current = Math.abs(e.clientX - d.x) > 2;
    commit(widths.current);
  };
  const fit = (col: number) => {
    const natural = naturalWidths();
    const next = [...(widths.current ?? natural)];
    next[col] = natural[col];
    commit(next);
  };

  return (
    <div className={`panel group/sheet relative isolate overflow-hidden ${className}`}>
      <div
        ref={box}
        className="sheet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // A drag on a header edge isn't a click on the header (sorting).
        onClickCapture={(e) => {
          if (justDragged.current) {
            justDragged.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        {children}
      </div>
      <div
        className={`absolute right-3 bottom-3 z-30 flex items-center gap-0.5 rounded-lg border border-line bg-surface/90 p-0.5 text-xs shadow-sm backdrop-blur-md transition-opacity duration-150 ${
          flashing ? "opacity-100" : "pointer-events-none opacity-0 group-hover/sheet:pointer-events-auto group-hover/sheet:opacity-100"
        }`}
      >
        <button type="button" onClick={() => setZoom(zoom.current / 1.15)} className="press h-7 w-7 rounded-md font-bold text-fg-2 hover:bg-raised active:scale-[0.98]" aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          className="press h-7 min-w-12 rounded-md px-1 font-mono text-fg-2 tabular-nums hover:bg-raised active:scale-[0.98]"
          title="Back to 100% (Ctrl + wheel or pinch to zoom)"
        >
          {Math.round(shownZoom * 100)}%
        </button>
        <button type="button" onClick={() => setZoom(zoom.current * 1.15)} className="press h-7 w-7 rounded-md font-bold text-fg-2 hover:bg-raised active:scale-[0.98]" aria-label="Zoom in">
          +
        </button>
        {sized && (
          <button
            type="button"
            onClick={() => commit(null)}
            className="press h-7 rounded-md px-2 font-medium text-fg-2 hover:bg-raised active:scale-[0.98]"
            title="Undo column sizing"
          >
            Reset columns
          </button>
        )}
      </div>
    </div>
  );
}
