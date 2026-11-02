"use client";

// An Apple-style segmented control: a sliding indicator behind the active option.
// `onAccent` is the variant for the royal blue top bar.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  tone = "default",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  tone?: "default" | "onAccent";
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const blue = tone === "onAccent";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`relative grid rounded-lg border p-0.5 ${blue ? "border-white/30 bg-white/10" : "border-line-strong bg-raised"}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className={`absolute inset-y-0.5 left-0.5 rounded-md ${blue ? "bg-white" : "bg-surface"} shadow-[0_1px_3px_rgba(17,19,24,0.18)] transition-transform duration-150 ease-snap`}
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => o.value !== value && onChange(o.value)}
          className={`press relative z-10 rounded-md py-1 text-xs font-semibold ${blue ? "px-2 sm:px-3.5" : "px-2.5 sm:px-3.5"} ${
            o.value === value ? (blue ? "text-accent" : "text-fg") : blue ? "text-white/85 hover:text-white" : "text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
