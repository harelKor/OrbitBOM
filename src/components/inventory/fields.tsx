"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { focusIfMouse } from "@/components/bom/Popover";
import { fieldChoices, type CategoryField } from "@/lib/inventory/categories";
import { LENGTH_STOCK } from "@/lib/inventory/stock";

// The add form's field controls: up to 6 choices are chips, more are a dropdown you type into
// (it filters as you type, arrows and Enter pick, recent picks first), and free values are a
// small box. Recent picks are remembered per browser.

const CHIP_MAX = 6;
const RECENT_KEY = "orbit-inventory-recent";
const listeners = new Set<() => void>();
const readRecent = (): Record<string, string[]> => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}");
  } catch {
    return {};
  }
};
let recentCache: Record<string, string[]> | null = null;
const recentStore = {
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: () => (recentCache ??= readRecent()),
  server: () => EMPTY,
};
const EMPTY: Record<string, string[]> = {};

export function rememberPick(key: string, value: string) {
  const all = { ...recentStore.get() };
  all[key] = [value, ...(all[key] ?? []).filter((v) => v !== value)].slice(0, 5);
  recentCache = all;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(all));
  } catch {}
  listeners.forEach((fn) => fn());
}

export function useRecent(key: string) {
  return useSyncExternalStore(recentStore.subscribe, recentStore.get, recentStore.server)[key] ?? [];
}

// Chips; with a recentKey, the values picked lately come first.
export function Chips({ options, value, onPick, size = "md", recentKey }: { options: string[]; value: string; onPick: (v: string) => void; size?: "md" | "lg"; recentKey?: string }) {
  // The order is fixed when the chips appear, so a chip doesn't jump away when it's tapped.
  const [recent] = useState(useRecent(recentKey ?? ""));
  const ordered = recentKey ? [...recent.filter((r) => options.includes(r)), ...options.filter((o) => !recent.includes(o))] : options;
  return (
    <div className="flex flex-wrap gap-1.5">
      {ordered.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => {
            onPick(o === value ? "" : o);
            if (recentKey && o !== value) rememberPick(recentKey, o);
          }}
          aria-pressed={o === value}
          className={`press rounded-full border font-semibold transition-colors ${size === "lg" ? "min-h-11 px-4 text-sm" : "min-h-9 px-3 text-xs"} ${
            o === value ? "border-accent bg-accent text-white" : "border-line-strong bg-surface text-fg-2 hover:border-accent hover:text-accent"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

type ComboProps = {
  options: string[];
  value: string;
  onPick: (v: string) => void;
  recentKey?: string;
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
};

const coarse = {
  subscribe: (fn: () => void) => {
    const m = matchMedia("(pointer: coarse)");
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  },
  get: () => matchMedia("(pointer: coarse)").matches,
  server: () => false,
};

// A type-to-filter dropdown. Typing a value that isn't in the list keeps it as typed. On touch
// screens the closed field is a button, so tapping it opens the list without the keyboard; the
// list's own search box opens the keyboard only when it's tapped (Harel, 2026-10-29).
export function Combo(props: ComboProps) {
  const touch = useSyncExternalStore(coarse.subscribe, coarse.get, coarse.server);
  return touch ? <TapCombo {...props} /> : <TypeCombo {...props} />;
}

function TapCombo({ options, value, onPick, recentKey, placeholder, ariaLabel }: ComboProps) {
  const recent = useRecent(recentKey ?? "");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  // A tap anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const typed = text.trim();
  const q = typed.toLowerCase();
  const ordered = [...recent.filter((r) => options.includes(r)), ...options.filter((o) => !recent.includes(o))];
  const shown = q ? ordered.filter((o) => o.toLowerCase().includes(q)) : ordered;
  const pick = (v: string) => {
    onPick(v);
    if (v && recentKey) rememberPick(recentKey, v);
    setText("");
    setOpen(false);
  };
  const row = "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm active:scale-[0.98]";
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setText("");
          setOpen((o) => !o);
        }}
        className="input flex min-h-11 w-full items-center gap-2 text-left"
      >
        <span className={`min-w-0 flex-1 truncate ${value ? "" : "text-subtle"}`}>{value || placeholder || "Pick…"}</span>
        <span aria-hidden className="text-xs text-subtle">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute top-full right-0 left-0 z-30 mt-1 rounded-xl border border-line-strong bg-surface p-1 shadow-lg">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                pick(shown.find((o) => o.toLowerCase() === q) ?? shown[0] ?? typed);
              }
            }}
            placeholder="Search or type a new one…"
            aria-label={`Search ${ariaLabel ?? "options"}`}
            className="input mb-1 min-h-10"
          />
          <ul id={listId} role="listbox" className="max-h-56 overflow-y-auto">
            {typed && !options.some((o) => o.toLowerCase() === q) && (
              <li>
                <button type="button" onClick={() => pick(typed)} className={`${row} font-semibold text-accent`}>
                  Use “{typed}”
                </button>
              </li>
            )}
            {shown.map((o) => (
              <li key={o} role="option" aria-selected={o === value}>
                <button type="button" onClick={() => pick(o)} className={`${row} ${o === value ? "bg-accent/10 font-semibold text-accent" : "text-fg-2"}`}>
                  {o}
                  {recent.includes(o) && <span className="ml-auto text-[0.625rem] text-subtle">recent</span>}
                </button>
              </li>
            ))}
            {value && !typed && (
              <li>
                <button type="button" onClick={() => pick("")} className={`${row} text-muted`}>
                  Clear
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function TypeCombo({
  options,
  value,
  onPick,
  recentKey,
  placeholder,
  autoFocus,
  ariaLabel,
}: ComboProps) {
  const recent = useRecent(recentKey ?? "");
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) focusIfMouse(input.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the field first shows
  }, []);
  const q = (text ?? "").trim().toLowerCase();
  const ordered = [...recent.filter((r) => options.includes(r)), ...options.filter((o) => !recent.includes(o))];
  const shown = q ? ordered.filter((o) => o.toLowerCase().includes(q)) : ordered;
  const pick = (v: string) => {
    onPick(v);
    if (v && recentKey) rememberPick(recentKey, v);
    setText(null);
    setOpen(false);
  };
  return (
    <div className="relative">
      <input
        ref={input}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        value={text ?? value}
        placeholder={placeholder ?? "Type or pick…"}
        onFocus={(e) => {
          setOpen(true);
          setActive(0);
          e.currentTarget.select();
        }}
        onBlur={() => {
          if (text !== null) pick(text.trim() ? (shown.find((o) => o.toLowerCase() === q) ?? text.trim()) : "");
          setOpen(false);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, shown.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            pick(shown[active] ?? text?.trim() ?? value);
          } else if (e.key === "Escape") {
            setText(null);
            setOpen(false);
          }
        }}
        className="input min-h-11"
      />
      {open && shown.length > 0 && (
        <ul id={listId} role="listbox" className="absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-line-strong bg-surface p-1 shadow-lg">
          {shown.map((o, i) => (
            <li key={o} role="option" aria-selected={i === active}>
              <button
                type="button"
                // mousedown, so the pick happens before the input's blur
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm ${i === active ? "bg-accent/10 text-accent" : "text-fg-2"} ${o === value ? "font-semibold" : ""}`}
              >
                {o}
                {recent.includes(o) && <span className="ml-auto text-[0.625rem] text-subtle">recent</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// One category field, as chips, a dropdown or a small box.
// Length stock's Length is always a free number, left empty when it isn't known, whatever choices
// Settings lists for it (Harel, 2026-11-24: Box tubes offered only "1000").
const isStockLength = (field: CategoryField, categoryId: string) => LENGTH_STOCK.has(categoryId) && (field.id === "length" || /^length\b/i.test(field.label.trim()));

export function FieldInput({ field, categoryId, value, onChange, autoFocus }: { field: CategoryField; categoryId: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  if (isStockLength(field, categoryId)) return <SmallBox field={{ ...field, kind: "number", options: undefined }} value={value} onChange={onChange} autoFocus={autoFocus} />;
  const choices = fieldChoices(field);
  if (choices.length && choices.length <= CHIP_MAX && field.kind === "options") return <Chips options={choices} value={value} onPick={onChange} recentKey={`${categoryId}:${field.id}`} />;
  if (choices.length) return <Combo options={choices} value={value} onPick={onChange} recentKey={`${categoryId}:${field.id}`} ariaLabel={field.label} autoFocus={autoFocus} />;
  return <SmallBox field={field} value={value} onChange={onChange} autoFocus={autoFocus} />;
}

// A free value. It takes the focus on its own only with a mouse, so a phone's keyboard stays shut.
function SmallBox({ field, value, onChange, autoFocus }: { field: CategoryField; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) focusIfMouse(input.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the field first shows
  }, []);
  return (
    <input
      ref={input}
      aria-label={field.label}
      inputMode={field.kind === "number" ? "decimal" : undefined}
      value={value}
      onChange={(e) => onChange(field.kind === "number" ? e.target.value.replace(/[^\d.]/g, "") : e.target.value)}
      className={`input min-h-11 ${field.kind === "number" ? "w-28 font-mono tabular-nums" : ""}`}
    />
  );
}
