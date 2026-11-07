"use client";

import { useEffect, useRef } from "react";

// Escape leaves a selection mode (Fab picking, bulk edit, …) while `active`. It waits for a window
// or popover to close first: open <dialog>s and popovers (which take the key) win, and so does
// typing in a field. Listens on window so document listeners (Popover) run before it. An Esc nobody
// used collapses a side column (Shell).
export function useEscape(active: boolean, onEscape: () => void) {
  const handler = useRef(onEscape);
  useEffect(() => {
    handler.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open]")) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      // Used: the shell's Esc (collapse a side column) leaves it alone.
      e.preventDefault();
      handler.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
