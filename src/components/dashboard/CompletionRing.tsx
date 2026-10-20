// Overall completion as a ring, blue filling to gold.
export function CompletionRing({ percent, done, total }: { percent: number; done: number; total: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden>
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" />
            <stop offset="100%" stopColor="var(--color-gold)" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-raised)" strokeWidth="9" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="url(#ring)"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(percent / 100) * c} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums">{percent}%</span>
        <span className="text-[11px] text-slate-500 tabular-nums">
          {done}/{total} done
        </span>
      </div>
    </div>
  );
}
