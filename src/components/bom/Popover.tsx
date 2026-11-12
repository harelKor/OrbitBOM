"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rankGrouped } from "@/lib/search/rank";

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
  panelClassName = "",
  width = WIDTH,
  onClosed,
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  triggerClassName?: string;
  align?: "left" | "right";
  locked?: boolean;
  hideCaret?: boolean;
  panelClassName?: string;
  // The panel's width; it never grows past the screen (or the dialog it opens in).
  width?: number;
  // Runs each time the panel closes, however it closed (so a menu can go back to its first page).
  onClosed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const closed = useRef(onClosed);
  useEffect(() => {
    closed.current = onClosed;
  });
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) closed.current?.();
    wasOpen.current = open;
  }, [open]);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number; width: number } | null>(null);
  const [host, setHost] = useState<Element | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Inside a dialog the panel stays within the dialog's sides, so nothing is cut off.
      const frame = host instanceof HTMLDialogElement ? host.getBoundingClientRect() : null;
      const minX = Math.max(8, (frame?.left ?? 0) + 8);
      const maxX = Math.min(vw - 8, (frame?.right ?? vw) - 8);
      const w = Math.min(width, maxX - minX);
      const height = panel.current?.offsetHeight ?? 320;
      const below = vh - r.bottom - GAP;
      const up = below < Math.min(height, 320) && r.top > below;
      const left = Math.min(Math.max(minX, align === "right" ? r.right - w : r.left), maxX - w);
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
      setPos({ left: left - dx, top: top - dy, maxHeight: room, width: w });
    };
    place();
    // When the panel's content changes (a menu turning into a search), place it again so it
    // keeps clear of the screen's edges.
    const watch = new ResizeObserver(() => place());
    if (panel.current) watch.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align, width, host]);

  useEffect(() => {
    if (!open) return;
    // pointerdown, like the part window's ⋮ menu: a tap outside on a phone closes it too.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    // Escape closes only the popover, not the window it's in.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
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
        aria-haspopup="dialog"
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
        {!hideCaret && <span className="text-[0.625rem] opacity-60">▾</span>}
      </button>
      {open &&
        host &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: pos?.width ?? width, maxHeight: pos?.maxHeight }}
            className={`fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-line-strong bg-surface p-2 text-fg shadow-[0_16px_40px_-12px_rgba(17,19,24,0.35)] ${panelClassName}`}
          >
            {children(close)}
          </div>,
          host,
        )}
    </>
  );
}

// Focuses a dropdown's search box when it opens, but only with a mouse: on a touch screen the
// focus would pop the keyboard over the list, so phones open it only when the box is tapped.
export function focusIfMouse(el: HTMLInputElement | null) {
  if (el && matchMedia("(pointer: fine)").matches) el.focus({ preventScroll: true });
}

// `hint` shows muted on the right (a material's stock); `divider` draws a line above the option's
// group header; `searchOnly` options appear only once something is typed (general materials).
export type Option = { value: string | null; label: string; color?: string; group?: string; hint?: string; divider?: boolean; searchOnly?: boolean };

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
  const needle = q.trim().toLowerCase();
  const matches = options.filter((o) =>
    o.searchOnly ? !!needle && o.label.toLowerCase().includes(needle) : o.label.toLowerCase().includes(needle) || (!!needle && !!o.group?.toLowerCase().includes(needle)),
  );
  // Typed: best matches first ("pla" lists PLA before Aluminum plate), groups kept together.
  const filtered = needle ? rankGrouped(matches, needle, (o) => o.label, (o) => o.group) : matches;
  // A divider belongs to its group, wherever ranking puts the group's first option.
  const divided = new Set(options.filter((o) => o.divider).map((o) => o.group));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input ref={focusIfMouse} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="input mb-1.5 py-2" />
      <ul className="min-h-0 flex-1 overflow-y-auto text-sm">
        {filtered.map((o, i) => {
          const header = o.group && (i === 0 || filtered[i - 1].group !== o.group) ? o.group : null;
          return (
            <li key={`${o.group ?? ""}:${o.value ?? ""}`}>
              {header && (
                <div className={`px-2.5 pt-2.5 pb-1 text-xs font-semibold text-subtle ${divided.has(o.group) && i > 0 ? "mt-2 border-t border-line" : ""}`}>
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
                <span className="min-w-0 flex-1">{o.label}</span>
                {o.hint !== undefined && (
                  <span className="shrink-0 rounded-full bg-raised px-1.5 font-mono text-[0.6875rem] leading-5 text-subtle tabular-nums" title="In stock">
                    {o.hint}
                  </span>
                )}
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
