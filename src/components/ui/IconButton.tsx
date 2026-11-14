"use client";

import { forwardRef } from "react";

// A square button holding an icon or a glyph (✕, ⋮, chevrons, Undo). Always has a label for screen
// readers, and is at least 40px on a touch screen however small it looks with a mouse.
const SIZES = {
  xs: "h-6 w-6 pointer-coarse:h-9 pointer-coarse:w-9",
  sm: "h-7 w-7 pointer-coarse:h-10 pointer-coarse:w-10",
  md: "h-8 w-8 pointer-coarse:h-10 pointer-coarse:w-10",
  lg: "h-10 w-10",
};

const TONES = {
  plain: "text-subtle hover:bg-raised hover:text-fg",
  outline: "border border-line-strong bg-surface text-fg-2 hover:border-accent/50 hover:bg-raised hover:text-fg",
  danger: "text-subtle hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-300",
};

export type IconButtonProps = {
  label: string;
  size?: keyof typeof SIZES;
  tone?: keyof typeof TONES;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", tone = "plain", className = "", title, type = "button", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      {...rest}
      className={`press flex shrink-0 items-center justify-center rounded-md active:scale-[0.98] disabled:opacity-30 ${SIZES[size]} ${TONES[tone]} ${className}`}
    >
      {children}
    </button>
  );
});
