"use client";

import { useEffect, useRef, useState } from "react";
import { HOLD_MS } from "./longPress";

// The call-cost popup (Harel, 2026-11-17): any element with `data-cost` (spread `costHint(…)` from
// src/config/callCosts.ts on it) shows that text in a small bubble while the mouse is over it, while
// it has keyboard focus, and after a finger rests on it for HOLD_MS (that hold then doesn't press
// the button). One listener for the whole page, mounted once in the root layout, so buttons only
// carry an attribute. It's a manual popover, so it shows above modal windows too.

const SLOP = 10; // px a finger may wander before the hold counts as a scroll

type Shown = { text: string; el: HTMLElement };

export function CallCostHints() {
  const [shown, setShown] = useState<Shown | null>(null);
  const tip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let hold: { timer: number; x: number; y: number } | null = null;
    let current: HTMLElement | null = null;
    let fadeTimer = 0;
    const costOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-cost]") : null);
    const show = (el: HTMLElement) => {
      clearTimeout(fadeTimer);
      current = el;
      // The native tooltip would sit on top of ours a second later: kept aside while it shows.
      if (el.title) {
        el.dataset.costTitle = el.title;
        el.removeAttribute("title");
      }
      setShown({ text: el.dataset.cost ?? "", el });
    };
    const hide = (el?: HTMLElement | null) => {
      if (el && el !== current) return;
      const was = current;
      current = null;
      if (was?.dataset.costTitle !== undefined) {
        was.title = was.dataset.costTitle;
        delete was.dataset.costTitle;
      }
      setShown(null);
    };

    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = costOf(e.target);
      if (el && el !== current) show(el);
      else if (!el && current) hide();
    };
    const out = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !current) return;
      if (!current.contains(e.relatedTarget as Node | null)) hide();
    };
    const focusIn = (e: FocusEvent) => {
      const el = costOf(e.target);
      if (el && el === e.target && el.matches(":focus-visible")) show(el);
    };
    const focusOut = (e: FocusEvent) => hide(costOf(e.target));

    // Phones: a finger held still shows the cost; lifting it doesn't press the button.
    const down = (e: PointerEvent) => {
      if (hold) clearTimeout(hold.timer);
      hold = null;
      if (e.pointerType === "mouse") return;
      const el = costOf(e.target);
      if (current && el !== current) hide();
      if (!el) return;
      const timer = window.setTimeout(() => {
        hold = null;
        show(el);
        swallowNextClick();
        fadeTimer = window.setTimeout(() => hide(el), 3000);
      }, HOLD_MS);
      hold = { timer, x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > SLOP) {
        clearTimeout(hold.timer);
        hold = null;
      }
    };
    const up = () => {
      if (hold) clearTimeout(hold.timer);
      hold = null;
    };
    // The phone's own long-press menu (a link's "Open in new tab") would cover the bubble.
    const menu = (e: Event) => {
      if (current && costOf(e.target) === current) e.preventDefault();
    };
    const away = () => hide();

    const opts = { capture: true, passive: true } as const;
    document.addEventListener("pointerover", over, opts);
    document.addEventListener("pointerout", out, opts);
    document.addEventListener("focusin", focusIn, true);
    document.addEventListener("focusout", focusOut, true);
    document.addEventListener("pointerdown", down, opts);
    document.addEventListener("pointermove", move, opts);
    document.addEventListener("pointerup", up, opts);
    document.addEventListener("pointercancel", up, opts);
    document.addEventListener("contextmenu", menu, true);
    window.addEventListener("scroll", away, opts);
    window.addEventListener("blur", away);
    return () => {
      if (hold) clearTimeout(hold.timer);
      clearTimeout(fadeTimer);
      document.removeEventListener("pointerover", over, opts);
      document.removeEventListener("pointerout", out, opts);
      document.removeEventListener("focusin", focusIn, true);
      document.removeEventListener("focusout", focusOut, true);
      document.removeEventListener("pointerdown", down, opts);
      document.removeEventListener("pointermove", move, opts);
      document.removeEventListener("pointerup", up, opts);
      document.removeEventListener("pointercancel", up, opts);
      document.removeEventListener("contextmenu", menu, true);
      window.removeEventListener("scroll", away, opts);
      window.removeEventListener("blur", away);
    };
  }, []);

  // Placed above the element (below when there's no room), kept inside the screen. A button taken
  // off the page (its window closed) takes the bubble with it.
  useEffect(() => {
    const t = tip.current;
    if (!t) return;
    if (!shown || !shown.el.isConnected) {
      if (t.matches(":popover-open")) t.hidePopover();
      return;
    }
    // Opened again each time, so it goes above a window that opened while it was showing.
    if (t.matches(":popover-open")) t.hidePopover();
    // Measured at the screen's corner, where its old place can't squeeze it into wrapping.
    t.style.left = "0px";
    t.style.top = "0px";
    t.showPopover();
    const r = shown.el.getBoundingClientRect();
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    const gap = 6;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    const top = r.top - h - gap >= 8 ? r.top - h - gap : Math.min(r.bottom + gap, window.innerHeight - h - 8);
    t.style.left = `${Math.round(left)}px`;
    t.style.top = `${Math.round(top)}px`;
  }, [shown]);

  return (
    <div
      ref={tip}
      popover="manual"
      role="tooltip"
      className="pointer-events-none fixed m-0 max-w-[min(18rem,calc(100vw-16px))] rounded-md border border-line-strong bg-surface px-2 py-1 text-xs font-medium text-fg-2 tabular-nums shadow-lg"
      style={{ inset: "auto" }}
    >
      {shown?.text}
    </div>
  );
}

// The click a phone sends when the held finger lifts: the hold was for reading the cost.
function swallowNextClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  const off = () => window.removeEventListener("click", stop, { capture: true });
  window.addEventListener("click", stop, { capture: true, once: true });
  window.addEventListener("pointerdown", off, { capture: true, once: true });
  setTimeout(off, 800);
}
