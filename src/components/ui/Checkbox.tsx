"use client";

import { CheckIcon } from "./CheckBadge";

// A large custom checkbox: 36px target on desktop, 44px on touch screens.
export function Checkbox({
  checked,
  onChange,
  label,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="press group inline-flex min-h-9 min-w-9 items-center gap-2 rounded-md text-left text-sm pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors duration-150 ${
          checked ? "border-accent bg-accent text-white" : "border-line-strong bg-surface group-hover:border-accent/50 group-hover:bg-raised"
        }`}
      >
        {checked && <CheckIcon className="h-3.5 w-3.5 animate-pop" />}
      </span>
      {children}
    </button>
  );
}
