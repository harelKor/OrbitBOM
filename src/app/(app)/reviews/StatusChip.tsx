export const STATUS_LABEL = { open: "Open", approved: "Approved", closed: "Closed" } as const;

// A review's status as a small chip (Waiting for mentor / Changes asked come with comments).
export function StatusChip({ status }: { status: keyof typeof STATUS_LABEL }) {
  const tone =
    status === "approved" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : status === "closed" ? "border border-line-strong text-subtle" : "bg-accent/10 text-accent";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{STATUS_LABEL[status]}</span>;
}
