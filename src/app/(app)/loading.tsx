// Shown inside the sidebar layout while the next page's data loads, so a click responds at once.
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded bg-slate-800" />
      <div className="h-24 animate-pulse rounded-lg bg-slate-900" />
      <div className="h-48 animate-pulse rounded-lg bg-slate-900" />
    </div>
  );
}
