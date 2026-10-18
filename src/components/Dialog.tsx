"use client";

import { useEffect, useRef } from "react";

export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
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
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-slate-700 bg-slate-900 p-0 text-slate-100 backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-100" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
