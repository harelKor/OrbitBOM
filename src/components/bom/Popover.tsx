"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const WIDTH = 288;
const GAP = 6;

// FRCBOM's card editing pattern: the field value is a button that opens a small panel.
// The panel floats above everything (it is portalled out of the card, so a card's clipping
// can't hide it), opens below the value or above it when there's no room, and stays on screen.
// A locked popover (a property in View mode) shows only its value.
export function Popover({
  trigger,
  children,
  triggerClassName = "",
  align = "left",
  locked = false,
  hideCaret = false,
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  triggerClassName?: string;
  align?: "left" | "right";
  locked?: boolean;
  hideCaret?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const [host, setHost] = useState<Element | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const height = panel.current?.offsetHeight ?? 320;
      const below = vh - r.bottom - GAP;
      const up = below < Math.min(height, 320) && r.top > below;
      const left = Math.min(Math.max(8, align === "right" ? r.right - WIDTH : r.left), vw - WIDTH - 8);
      const room = (up ? r.top : below) - GAP - 8;
      const top = up ? Math.max(8, r.top - GAP - Math.min(height, room)) : r.bottom + GAP;
      // If something around the panel (a window mid-animation) is the frame for fixed elements,
      // the panel lands off by that frame's offset: measure it and take it back out.
      const p = panel.current;
      let dx = 0;
      let dy = 0;
      if (p) {
        const at = p.getBoundingClientRect();
        dx = at.left - parseFloat(p.style.left || "0");
        dy = at.top - parseFloat(p.style.top || "0");
      }
      setPos({ left: left - dx, top: top - dy, maxHeight: room });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    // Escape closes only the popover, not the window it's in.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (locked) return <span className={`inline-flex items-center gap-1 ${triggerClassName}`}>{trigger}</span>;
  const close = () => setOpen(false);
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        onClick={(e) => {
          setPos(null);
          // Inside a modal dialog the panel must stay in the dialog's top layer.
          setHost(e.currentTarget.closest("dialog") ?? document.body);
          setOpen((o) => !o);
        }}
        className={`press inline-flex items-center gap-1 rounded text-left hover:text-accent ${triggerClassName}`}
      >
        {trigger}
        {!hideCaret && <span className="text-[10px] opacity-60">▾</span>}
      </button>
      {open &&
        host &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH, maxHeight: pos?.maxHeight }}
            className="fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-line-strong bg-surface p-2 text-fg shadow-[0_16px_40px_-12px_rgba(17,19,24,0.35)]"
          >
            {children(close)}
          </div>,
          host,
        )}
    </>
  );
}

export type Option = { value: string | null; label: string; color?: string; group?: string };

// A searchable list, like FRCBOM's status and material menus.
export function OptionList({
  options,
  value,
  onPick,
  placeholder = "Search…",
}: {
  options: Option[];
  value: string | null;
  onPick: (value: string | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="input mb-1.5 py-2" />
      <ul className="min-h-0 flex-1 overflow-y-auto text-sm">
        {filtered.map((o, i) => {
          const header = o.group && (i === 0 || filtered[i - 1].group !== o.group) ? o.group : null;
          return (
            <li key={`${o.group ?? ""}:${o.value ?? ""}`}>
              {header && (
                <div className="px-2.5 pt-2.5 pb-1 text-xs font-semibold text-subtle">
                  {header}
                </div>
              )}
              <button
                type="button"
                onClick={() => onPick(o.value)}
                className={`flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-raised ${
                  o.value === value ? "bg-accent/10 font-semibold text-accent" : "text-fg-2"
                }`}
              >
                {o.color && <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: o.color }} />}
                {o.label}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && <li className="px-2 py-1 text-subtle">No matches</li>}
      </ul>
    </div>
  );
}

// An input with Cancel/Save.
export function InputEditor({
  value,
  onSave,
  onCancel,
  type = "text",
  multiline = false,
  suggestions,
}: {
  value: string;
  onSave: (value: string) => void;
  onCancel: () => void;
  type?: "text" | "number" | "date" | "url";
  multiline?: boolean;
  suggestions?: string[];
}) {
  const [v, setV] = useState(value);
  const id = useId();
  const listId = suggestions ? id : undefined;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v);
      }}
      className="space-y-2"
    >
      {multiline ? (
        <textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} rows={3} className="input" />
      ) : (
        <input autoFocus type={type} value={v} onChange={(e) => setV(e.target.value)} className="input" list={listId} min={type === "number" ? 0 : undefined} />
      )}
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary">Save</button>
      </div>
    </form>
  );
}
