"use client";

import type { CSSProperties } from "react";
import type { Condition } from "./types";

// The condition pill as a native menu that is only as wide as the label it shows (Harel,
// 2026-11-02): a plain <select> is as wide as its longest option, so "New" took the room of
// "No condition". An invisible copy of the shown label sets the width and the select is laid
// over it (out of flow, so its own width can't stretch the pill). `className` carries the pill's
// padding, text and border, so give it the room the caret needs on the right.
export function ConditionSelect({
  conditions,
  value,
  onChange,
  emptyLabel,
  disabled,
  className = "",
  style,
}: {
  conditions: Condition[];
  value: string | null;
  onChange: (conditionId: string | null) => void;
  emptyLabel: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const current = conditions.find((c) => c.id === value);
  return (
    <span className="relative inline-flex min-w-0 max-w-full shrink-0">
      <span aria-hidden className={`${className} invisible max-w-full overflow-hidden whitespace-nowrap`}>
        {current?.label ?? emptyLabel}
      </span>
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label="Condition"
        className={`${className} absolute inset-0 h-full w-full min-w-0`}
        style={style}
      >
        <option value="" className="bg-surface text-fg">
          {current ? "No condition" : emptyLabel}
        </option>
        {conditions.map((c) => (
          <option key={c.id} value={c.id} className="bg-surface text-fg">
            {c.label}
          </option>
        ))}
      </select>
    </span>
  );
}
