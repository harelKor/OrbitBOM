"use client";

// A small rounded tag that can be tapped (a filter, a maker, a priority, a tag). 36px tall on a
// touch screen; `on` shows it picked.
export function Chip({
  on = false,
  className = "",
  type = "button",
  children,
  ...rest
}: { on?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      aria-pressed={rest.onClick ? on : undefined}
      {...rest}
      className={`press inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap active:scale-[0.98] disabled:opacity-50 pointer-coarse:min-h-9 pointer-coarse:px-3 ${
        on ? "border-accent bg-accent text-white" : "border-line-strong bg-surface text-fg-2 hover:border-accent/50 hover:bg-raised hover:text-fg"
      } ${className}`}
    >
      {children}
    </button>
  );
}
