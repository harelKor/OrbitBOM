"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

// Long press on phones (Harel, 2026-11-12): a finger held still on a card, row or search result.
// Mice never trigger it; on a PC the page's own buttons do the same jobs.
export const HOLD_MS = 450;
const SLOP = 10; // px a finger may wander before it counts as a scroll
// Presses that start on these controls inside the thing are theirs, not a hold (the stock − / +).
const CONTROLS = "button, input, select, textarea, label, [role=dialog]";

// Once a hold has fired, the page must not scroll under the finger, and the click that follows the
// release must not open the thing.
const block = (e: TouchEvent) => e.preventDefault();
function swallowNextClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  const off = () => window.removeEventListener("click", stop, { capture: true });
  window.addEventListener("click", stop, { capture: true, once: true });
  // Some phones send no click after a long press: the next tap's own click must still work.
  window.addEventListener("pointerdown", off, { capture: true, once: true });
  setTimeout(off, 600);
}

// The element matching `selector` under the finger, inside `area`, unless the press began on a
// control of its own.
export function holdTarget(target: EventTarget, area: Element, selector: string): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(selector);
  if (!el || !area.contains(el)) return null;
  const control = target.closest(CONTROLS);
  if (control && control !== el && el.contains(control)) return null;
  return el;
}

// Pointer handlers for an area: `find` names what's under the finger (null = nothing to hold),
// `onHold` runs once the finger has rested HOLD_MS, `onRelease` when it lifts after that.
// Pair it with the `hold-area` class so phones don't select text or show the link menu.
export function useLongPress<T>({
  find,
  onHold,
  onRelease,
  enabled = true,
}: {
  find: (target: EventTarget, area: Element) => T | null;
  onHold: (hit: T) => void;
  onRelease?: () => void;
  enabled?: boolean;
}) {
  const press = useRef<{ x: number; y: number; timer: number; fired: boolean; release?: () => void } | null>(null);
  const end = () => {
    const cur = press.current;
    press.current = null;
    if (!cur) return;
    clearTimeout(cur.timer);
    if (!cur.fired) return;
    document.removeEventListener("touchmove", block);
    swallowNextClick();
    cur.release?.();
  };
  useEffect(
    () => () => {
      const cur = press.current;
      if (cur) clearTimeout(cur.timer);
      document.removeEventListener("touchmove", block);
    },
    [],
  );
  return {
    onPointerDown(e: React.PointerEvent) {
      if (!enabled || e.pointerType === "mouse" || !e.isPrimary) return;
      end();
      const hit = find(e.target, e.currentTarget);
      if (hit === null) return;
      const cur = { x: e.clientX, y: e.clientY, timer: 0, fired: false, release: onRelease };
      cur.timer = window.setTimeout(() => {
        cur.fired = true;
        document.addEventListener("touchmove", block, { passive: false });
        navigator.vibrate?.(12);
        onHold(hit);
      }, HOLD_MS);
      press.current = cur;
    },
    onPointerMove(e: React.PointerEvent) {
      const cur = press.current;
      if (!cur || cur.fired || Math.hypot(e.clientX - cur.x, e.clientY - cur.y) <= SLOP) return;
      clearTimeout(cur.timer);
      press.current = null;
    },
    onPointerUp: end,
    onPointerCancel: end,
    // Android opens the link / image menu on a long press; the hold owns it.
    onContextMenu(e: React.MouseEvent) {
      if (press.current) e.preventDefault();
    },
  };
}

// `host`: where the card is drawn; inside an open <dialog> (the top layer) it must go there.
export type Peek = { title: string; image: string | null; detail?: string; host: Element };

// Holding a search result shows its whole name and a big picture until the finger lifts (search
// rows cut long names off). A row opts in with data-peek-title, data-peek-image, data-peek-detail.
export function usePeek() {
  const [peek, setPeek] = useState<Peek | null>(null);
  const hold = useLongPress<Peek>({
    find: (t, area) => {
      const el = holdTarget(t, area, "[data-peek-title]");
      if (!el) return null;
      return {
        title: el.dataset.peekTitle ?? "",
        image: el.dataset.peekImage || null,
        detail: el.dataset.peekDetail || undefined,
        host: el.closest("dialog") ?? document.body,
      };
    },
    onHold: setPeek,
    onRelease: () => setPeek(null),
  });
  return { hold, card: peek && <PeekCard peek={peek} /> };
}

// The data attributes a row needs for usePeek.
export const peekProps = (title: string, image: string | null | undefined, detail?: string | null) => ({
  "data-peek-title": title,
  "data-peek-image": image ?? "",
  "data-peek-detail": detail ?? "",
});

function PeekCard({ peek }: { peek: Peek }) {
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
      <div className="modal-enter w-[min(24rem,100%)] overflow-hidden rounded-2xl border border-line-strong bg-surface text-fg shadow-2xl">
        <div className="flex aspect-square max-h-[55vh] w-full items-center justify-center bg-white">
          {peek.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 / store links
            <img src={peek.image} alt="" className="h-full w-full object-contain p-4" />
          ) : (
            <Icon name="box" className="h-16 w-16 text-slate-400" />
          )}
        </div>
        <div className="space-y-1 p-4">
          <p className="text-lg leading-snug font-bold break-words">{peek.title}</p>
          {peek.detail && <p className="text-sm break-words text-muted tabular-nums">{peek.detail}</p>}
        </div>
      </div>
    </div>,
    peek.host,
  );
}
