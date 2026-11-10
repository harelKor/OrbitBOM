// Steps done out of all, green when every one is.
export function Progress({ done, total }: { done: number; total: number }) {
  if (!total) return null;
  return <span className={`shrink-0 rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${done === total ? "bg-emerald-500/15 text-emerald-600" : "bg-raised text-fg-2"}`}>{`${done}/${total}`}</span>;
}
