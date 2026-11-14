// A boxed message on a page or in a window: a failed save, a done restore, a warning. One look on
// both themes (the old bg-rose-50 boxes were white-on-white in dark mode).
export type NoticeTone = "error" | "success" | "warning" | "info";

const TONES: Record<NoticeTone, string> = {
  error: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-500/45 dark:bg-rose-500/12 dark:text-rose-200",
  success: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/45 dark:bg-emerald-500/12 dark:text-emerald-200",
  warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/45 dark:bg-amber-500/12 dark:text-amber-200",
  info: "border-line bg-raised text-fg-2",
};

export function noticeClass(tone: NoticeTone) {
  return `rounded-md border px-3 py-2 text-sm ${TONES[tone]}`;
}

export function Notice({
  tone = "info",
  className = "",
  children,
  ...rest
}: { tone?: NoticeTone; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div role={tone === "error" ? "alert" : "status"} {...rest} className={`${noticeClass(tone)} ${className}`}>
      {children}
    </div>
  );
}
