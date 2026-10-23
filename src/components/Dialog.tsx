"use client";

import { useEffect, useRef } from "react";

export function Dialog({
  open,
  onClose,
  title,
  wide = false,
  width,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  wide?: boolean;
  width?: string; // a width class, in place of the two standard widths
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={`m-auto ${width ?? (wide ? "w-[min(40rem,calc(100vw-2rem))]" : "w-[min(28rem,calc(100vw-2rem))]")} modal p-0`}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        <button onClick={onClose} className="press rounded p-1 text-muted hover:text-fg" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
