"use client";

// The red − and green + around a count (inventory stock, a part's done count). Five copies used to
// differ in size; these are the one button, at least 40px on a touch screen (44px for "lg").
const SIZES = {
  xs: "h-6 w-6 text-sm rounded-md pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:text-lg",
  sm: "h-8 w-8 text-lg rounded-md pointer-coarse:h-10 pointer-coarse:w-10",
  md: "h-9 w-10 text-lg rounded-md pointer-coarse:h-10 pointer-coarse:w-11",
  lg: "h-11 w-11 text-xl rounded-lg",
  xl: "h-12 w-12 text-2xl rounded-lg",
};

export type StepSize = keyof typeof SIZES;

export function StepButton({
  step: dir,
  size = "sm",
  quiet = false,
  className = "",
  label,
  ...rest
}: {
  step: -1 | 1; // − or +
  size?: StepSize;
  quiet?: boolean; // grey until hovered, for a counter inside a card's text
  label?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const tone = quiet
    ? "border border-line-strong bg-surface text-fg-2 hover:border-accent/50 hover:text-fg"
    : dir < 0
      ? "bg-rose-500 text-white shadow-sm hover:bg-rose-400"
      : "bg-emerald-500 text-white shadow-sm hover:bg-emerald-400";
  return (
    <button
      type="button"
      aria-label={label ?? (dir < 0 ? "One less" : "One more")}
      {...rest}
      className={`press flex shrink-0 items-center justify-center font-bold active:scale-[0.98] disabled:opacity-30 ${SIZES[size]} ${tone} ${className}`}
    >
      {dir < 0 ? "−" : "+"}
    </button>
  );
}

// − value + in a row.
export function Stepper({
  onStep,
  canLess = true,
  size = "sm",
  quiet = false,
  lessLabel,
  moreLabel,
  className = "",
  children,
}: {
  onStep: (d: -1 | 1) => void;
  canLess?: boolean;
  size?: StepSize;
  quiet?: boolean;
  lessLabel?: string;
  moreLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <StepButton step={-1} size={size} quiet={quiet} label={lessLabel} disabled={!canLess} onClick={() => onStep(-1)} />
      {children}
      <StepButton step={1} size={size} quiet={quiet} label={moreLabel} onClick={() => onStep(1)} />
    </span>
  );
}
