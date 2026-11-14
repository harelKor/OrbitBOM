"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The newest open modal window, or the page. A modal <dialog> (Dialog's showModal) sits in the
// browser's top layer above every z-index and makes the rest of the page inert, so a toast or the
// offline bar must live inside it to be seen and tapped.
function topHost(): HTMLElement {
  for (let i = opened.length - 1; i >= 0; i--) {
    const el = opened[i];
    if (el.isConnected && el.matches(":modal")) return el;
  }
  const open = document.querySelectorAll<HTMLDialogElement>("dialog:modal");
  return open[open.length - 1] ?? document.body;
}

// Windows in the order they opened: page order says nothing about which one is on top (a confirm
// asked from inside a window is rendered elsewhere in the page but opens above it).
const opened: HTMLElement[] = [];
export function modalOpened(el: HTMLElement) {
  const at = opened.indexOf(el);
  if (at >= 0) opened.splice(at, 1);
  opened.push(el);
  if (opened.length > 20) opened.splice(0, opened.length - 20);
}

// Follows windows opening and closing (showModal and close() flip the open attribute) and an open
// window taken off the page. Only runs while something is shown.
function useTopHost(active: boolean): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const update = () => setHost(topHost());
    update();
    const mo = new MutationObserver(update);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => mo.disconnect();
  }, [active]);
  return active ? host : null;
}

// Something that must show above everything, open windows included (toasts, the offline bar): a
// manual popover in the newest window (or the page), shown again whenever it moves, so it is the
// top of the top layer. Its own position comes from className (it starts with no inset or margin).
export function TopLayer({ className, children, ...rest }: { className: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const host = useTopHost(true);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function") return;
    try {
      if (el.matches(":popover-open")) el.hidePopover();
      el.showPopover();
    } catch {
      // A browser without popovers: the element stays a plain fixed box.
    }
  });
  if (!host) return null;
  return createPortal(
    <div ref={ref} popover="manual" {...rest} className={`fixed inset-auto m-0 overflow-visible border-0 bg-transparent p-0 text-inherit ${className}`}>
      {children}
    </div>,
    host,
  );
}
