import type { Breakdown } from "@/lib/stats";

// A stacked status bar with a count and % for each status that has parts.
export function StatusBar({ breakdown, legend = true }: { breakdown: Breakdown; legend?: boolean }) {
  const shown = breakdown.statuses.filter((s) => s.count > 0);
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-raised">
        {shown.map((s) => (
          <div
            key={s.name}
            style={{ width: `${(s.count / breakdown.total) * 100}%`, background: s.color }}
            title={`${s.name}: ${s.count}`}
          />
        ))}
      </div>
      {legend && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {shown.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.name}
              <span className="text-subtle tabular-nums">
                {s.count} · {s.percent}%
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span className="tabular-nums">
        <span className="font-semibold text-fg">{done}</span>/{total}
      </span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-raised">
        <div className="h-full bg-emerald-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
    </div>
  );
}
