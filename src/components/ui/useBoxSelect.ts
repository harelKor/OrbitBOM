"use client";

import { useEffect, useRef, useState } from "react";
import { HOLD_MS, swallowNextClick } from "./longPress";

// Box select in lists, cards and tables (Harel, 2026-11-17): while a page's select mode is on, a
// finger held still for HOLD_MS (or a mouse pressed and dragged) draws a rectangle, and every row
// it crosses is added to the selection on release. Near the top or bottom the page scrolls by
// itself. A plain swipe still scrolls; a held button that shows its call cost (data-cost) still
// shows it. The 3D views have their own (src/components/viewer/picking.ts).

const SLOP = 10; // px a finger may wander before the hold counts as a scroll
const MOUSE_START = 6; // px a mouse must move before a press becomes a box
const EDGE = 64; // px from the top / bottom where the page scrolls under the box
const MAX_STEP = 22; // px per frame at the very edge
// Presses that start on these are theirs: fields, windows, cost hints, anything opting out.
const SKIP = "input, textarea, select, [contenteditable=true], dialog, [role=dialog], [data-cost], [data-no-box]";

export type BoxSelectOptions = {
  enabled: boolean; // the page's select mode is on
  selector: string; // what a row is (inside the area)
  keyOf: (el: HTMLElement) => string | null; // the row's selection key (null: not pickable)
  onBox: (keys: string[]) => void; // the rows the box crossed, each once, top first
};

// Returns a ref for the area (the element holding the rows).
export function useBoxSelect(options: BoxSelectOptions) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const [area, setArea] = useState<HTMLElement | null>(null);
  useEffect(() => (area ? attachBoxSelect(area, () => latest.current) : undefined), [area]);
  return setArea;
}

// The nearest scrolling ancestor, or null for the window.
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p).overflowY;
    if ((s === "auto" || s === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

type Drag = {
  sx: number; // where it began, in the scroller's content (client + scroll)
  sy: number;
  x: number; // the pointer now (client px)
  y: number;
  finger: boolean; // a touch (its moves come as touchmove too, and it ends with touchend)
  scroller: HTMLElement | null;
  div: HTMLDivElement;
  hits: Set<HTMLElement>;
  frame: number;
  last: string;
};

export function attachBoxSelect(area: HTMLElement, get: () => BoxSelectOptions) {
  let press: { id: number; x: number; y: number; touch: boolean; timer: number } | null = null;
  let drag: Drag | null = null;
  const scrollTop = (s: HTMLElement | null) => (s ? s.scrollTop : window.scrollY);
  const scrollLeft = (s: HTMLElement | null) => (s ? s.scrollLeft : window.scrollX);

  const box = (d: Drag) => {
    const ax = d.sx - scrollLeft(d.scroller);
    const ay = d.sy - scrollTop(d.scroller);
    return { left: Math.min(ax, d.x), top: Math.min(ay, d.y), right: Math.max(ax, d.x), bottom: Math.max(ay, d.y) };
  };
  // The rectangle and the rows under it (marked data-box-hit, so they light up while dragging).
  const paint = (d: Drag) => {
    const r = box(d);
    const key = `${r.left},${r.top},${r.right},${r.bottom}`;
    if (key === d.last) return;
    d.last = key;
    Object.assign(d.div.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
    const now = new Set<HTMLElement>();
    for (const el of area.querySelectorAll<HTMLElement>(get().selector)) {
      const b = el.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      if (b.right >= r.left && b.left <= r.right && b.bottom >= r.top && b.top <= r.bottom) now.add(el);
    }
    for (const el of d.hits) if (!now.has(el)) delete el.dataset.boxHit;
    for (const el of now) el.dataset.boxHit = "";
    d.hits = now;
  };
  const tick = () => {
    const d = drag;
    if (!d) return;
    const v = d.scroller ? d.scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    // Under the window's sticky top bar nothing shows: the edge starts below it.
    const bar = d.scroller ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 0;
    const top = v.top + bar + EDGE;
    const bottom = v.bottom - EDGE;
    let dy = 0;
    if (d.y < top) dy = -Math.min(MAX_STEP, Math.ceil(((top - d.y) / EDGE) * MAX_STEP));
    else if (d.y > bottom) dy = Math.min(MAX_STEP, Math.ceil(((d.y - bottom) / EDGE) * MAX_STEP));
    if (dy) (d.scroller ?? window).scrollBy(0, dy);
    paint(d);
    d.frame = requestAnimationFrame(tick);
  };

  // Once a finger's box has begun, the page must not scroll under it; its moves still come here.
  const block = (e: TouchEvent) => {
    e.preventDefault();
    const t = e.touches[0];
    if (drag && t) [drag.x, drag.y] = [t.clientX, t.clientY];
  };
  const start = (x: number, y: number, touch: boolean) => {
    const scroller = scrollerOf(area);
    const div = document.createElement("div");
    div.className = "box-select-rect";
    document.body.appendChild(div);
    drag = { sx: x + scrollLeft(scroller), sy: y + scrollTop(scroller), x, y, finger: touch, scroller, div, hits: new Set(), frame: 0, last: "" };
    document.documentElement.classList.add("box-selecting");
    window.getSelection()?.removeAllRanges();
    if (touch) {
      document.addEventListener("touchmove", block, { passive: false });
      navigator.vibrate?.(12);
    }
    paint(drag);
    drag.frame = requestAnimationFrame(tick);
  };
  const finish = (commit: boolean) => {
    const d = drag;
    if (!d) return;
    paint(d);
    drag = null;
    cancelAnimationFrame(d.frame);
    d.div.remove();
    for (const el of d.hits) delete el.dataset.boxHit;
    document.documentElement.classList.remove("box-selecting");
    document.removeEventListener("touchmove", block);
    // The click that follows the release must not also toggle or open the row under it.
    swallowNextClick();
    if (!commit) return;
    const { keyOf, onBox } = get();
    const rows = [...d.hits].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const keys = [...new Set(rows.map(keyOf).filter((k): k is string => !!k))];
    if (keys.length) onBox(keys);
  };
  const cancelPress = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };

  const down = (e: PointerEvent) => {
    if (!get().enabled || !e.isPrimary || e.button !== 0 || drag) return;
    if (!(e.target instanceof Element) || e.target.closest(SKIP)) return;
    cancelPress();
    const touch = e.pointerType !== "mouse"; // a finger or a pen: held, not dragged straight away
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, touch, timer: 0 };
    if (touch)
      p.timer = window.setTimeout(() => {
        if (press !== p) return;
        press = null;
        start(p.x, p.y, e.pointerType === "touch");
      }, HOLD_MS);
    press = p;
  };
  const move = (e: PointerEvent) => {
    if (press && e.pointerId === press.id) {
      const far = Math.hypot(e.clientX - press.x, e.clientY - press.y);
      if (press.touch) {
        if (far > SLOP) cancelPress(); // a scroll
      } else if (far > MOUSE_START) {
        const p = press;
        press = null;
        start(p.x, p.y, false);
      }
    }
    if (drag && e.isPrimary) [drag.x, drag.y] = [e.clientX, e.clientY];
  };
  const up = (e: PointerEvent) => {
    if (press?.id === e.pointerId) cancelPress();
    if (drag && e.isPrimary) finish(true);
  };
  // A finger's box ends with the finger (a pointercancel on the way doesn't end it).
  const touchEnd = (e: TouchEvent) => {
    if (drag?.finger && e.touches.length === 0) finish(true);
  };
  const pointerCancel = () => {
    cancelPress();
    if (drag && !drag.finger) finish(false);
  };
  // Phones open the link / image menu on a long press; dragging a picture would start a drag-and-drop.
  const menu = (e: Event) => {
    if (press || drag) e.preventDefault();
  };
  const escape = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !drag) return;
    e.preventDefault(); // useEscape then leaves the select mode alone
    e.stopPropagation();
    finish(false);
  };
  const blur = () => {
    cancelPress();
    finish(false);
  };

  area.addEventListener("pointerdown", down);
  area.addEventListener("contextmenu", menu);
  area.addEventListener("dragstart", menu);
  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", pointerCancel);
  window.addEventListener("touchend", touchEnd);
  window.addEventListener("touchcancel", touchEnd);
  window.addEventListener("keydown", escape, { capture: true });
  window.addEventListener("blur", blur);
  return () => {
    cancelPress();
    finish(false);
    area.removeEventListener("pointerdown", down);
    area.removeEventListener("contextmenu", menu);
    area.removeEventListener("dragstart", menu);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", pointerCancel);
    window.removeEventListener("touchend", touchEnd);
    window.removeEventListener("touchcancel", touchEnd);
    window.removeEventListener("keydown", escape, { capture: true });
    window.removeEventListener("blur", blur);
  };
}
