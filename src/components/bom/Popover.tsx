"use client";

import { useEffect, useId, useRef, useState } from "react";

// FRCBOM's card editing pattern: the field value is a button that opens a small panel.
// A locked popover (a property in View mode) shows only its value.
export function Popover({
  trigger,
  children,
  triggerClassName = "",
  align = "left",
  locked = false,
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  triggerClassName?: string;
  align?: "left" | "right";
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (locked) return <span className={`inline-flex items-center gap-1 ${triggerClassName}`}>{trigger}</span>;
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 rounded text-left hover:text-accent-soft ${triggerClassName}`}
      >
        {trigger}
        <span className="text-[10px] text-slate-500">▾</span>
      </button>
      {open && (
        <div
          className={`absolute z-30 mt-1 w-64 rounded-lg border border-line-strong bg-surface p-2 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
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
    <div>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="input mb-1.5" />
      <ul className="max-h-64 overflow-y-auto text-sm">
        {filtered.map((o, i) => {
          const header = o.group && (i === 0 || filtered[i - 1].group !== o.group) ? o.group : null;
          return (
            <li key={`${o.group ?? ""}:${o.value ?? ""}`}>
              {header && (
                <div className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                  {header}
                </div>
              )}
              <button
                type="button"
                onClick={() => onPick(o.value)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-raised ${
                  o.value === value ? "bg-raised text-white" : "text-slate-300"
                }`}
              >
                {o.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.color }} />}
                {o.label}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && <li className="px-2 py-1 text-slate-500">No matches</li>}
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
