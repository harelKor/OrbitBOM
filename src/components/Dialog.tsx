"use client";

import { useEffect, useRef } from "react";

export function Dialog({
  open,
  onClose,
  title,
  actions,
  wide = false,
  width,
  sheet = false,
  compact = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  actions?: React.ReactNode; // buttons in the title bar, right of the title and left of ✕
  wide?: boolean;
  width?: string; // a width class, in place of the two standard widths
  sheet?: boolean; // on phones: a full-width sheet up from the bottom, its title bar kept in view
  compact?: boolean; // on phones: tighter padding and the actions kept in the title row (no second row)
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // showModal focuses the first field inside, which pops the keyboard open on a phone. On
      // touch screens the window itself takes the focus instead; a field opens the keyboard
      // only when it's tapped (Harel, 2026-10-29).
      const touch = matchMedia("(pointer: coarse)").matches;
      dialog.toggleAttribute("autofocus", touch);
      dialog.showModal();
      if (touch && document.activeElement !== dialog) dialog.focus({ preventScroll: true });
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      // React hands a window inside this one its close event too; only this window's own counts.
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      // Never taller than the visible screen (dvh: a phone's browser bars and keyboard taken off);
      // the window scrolls inside, its title bar staying on top with ✕.
      className={`m-auto ${width ?? (wide ? "w-[min(40rem,calc(100vw-2rem))]" : "w-[min(28rem,calc(100vw-2rem))]")} max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain modal p-0 outline-none ${sheet ? SHEET : ""}`}
    >
      <div className={`flex items-center justify-between gap-2 border-b border-line px-5 py-3 ${actions && !compact ? "max-sm:flex-wrap" : ""} ${compact ? "max-sm:px-3 max-sm:py-2" : ""} sticky top-0 z-[2] bg-surface ${sheet ? "max-sm:px-4" : ""}`}>
        <h2 className={`min-w-0 flex-1 font-semibold ${compact ? "max-sm:text-sm max-sm:leading-tight" : ""}`}>{title}</h2>
        {actions && (
          <div className={`flex flex-wrap items-center justify-end gap-1.5 ${compact ? "max-sm:shrink-0 max-sm:flex-nowrap" : "max-sm:order-last max-sm:basis-full max-sm:justify-start"}`}>{actions}</div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="press -my-1 -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-raised hover:text-fg"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className={sheet ? "p-5 max-sm:px-4 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]" : compact ? "p-5 max-sm:p-3" : "p-5"}>{children}</div>
    </dialog>
  );
}

const SHEET = "max-sm:mx-0! max-sm:mt-auto! max-sm:mb-0! max-sm:w-full! max-sm:max-w-full! max-sm:max-h-[90dvh]! max-sm:rounded-b-none! max-sm:border-b-0! max-sm:sheet-up";
