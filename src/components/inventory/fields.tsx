"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { focusIfMouse } from "@/components/bom/Popover";
import { fieldChoices, type CategoryField } from "@/lib/inventory/categories";

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

// A type-to-filter dropdown. Typing a value that isn't in the list keeps it as typed.
export function Combo({
  options,
  value,
  onPick,
  recentKey,
  placeholder,
  autoFocus,
  ariaLabel,
}: {
  options: string[];
  value: string;
  onPick: (v: string) => void;
  recentKey?: string;
  placeholder?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
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
                {recent.includes(o) && <span className="ml-auto text-[10px] text-subtle">recent</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// One category field, as chips, a dropdown or a small box.
export function FieldInput({ field, categoryId, value, onChange, autoFocus }: { field: CategoryField; categoryId: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const choices = fieldChoices(field);
  if (choices.length && choices.length <= CHIP_MAX && field.kind === "options") return <Chips options={choices} value={value} onPick={onChange} recentKey={`${categoryId}:${field.id}`} />;
  if (choices.length) return <Combo options={choices} value={value} onPick={onChange} recentKey={`${categoryId}:${field.id}`} ariaLabel={field.label} autoFocus={autoFocus} />;
  return (
    <input
      autoFocus={autoFocus}
      aria-label={field.label}
      inputMode={field.kind === "number" ? "decimal" : undefined}
      value={value}
      onChange={(e) => onChange(field.kind === "number" ? e.target.value.replace(/[^\d.]/g, "") : e.target.value)}
      className={`input min-h-11 ${field.kind === "number" ? "w-28 font-mono tabular-nums" : ""}`}
    />
  );
}
