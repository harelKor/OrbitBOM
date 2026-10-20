"use client";

// An Apple-style segmented control: a sliding indicator behind the active option.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="radiogroup" aria-label={label} className="relative grid rounded-lg border border-line-strong bg-ink p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      <span
        aria-hidden
        className="absolute inset-y-0.5 left-0.5 rounded-md bg-line shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] transition-transform duration-150 ease-snap"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => o.value !== value && onChange(o.value)}
          className={`press relative z-10 rounded-md px-3 py-1 text-xs font-semibold ${
            o.value === value ? "text-white" : "text-slate-400 hover:text-slate-100"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
