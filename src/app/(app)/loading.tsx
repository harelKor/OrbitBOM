// Shown while the next page's data loads, so a click responds at once: skeletons shaped like
// the page title and the part card grid.
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-8 w-56" />
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-7 w-20 rounded-full" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-white/[0.06]">
            <div className="skeleton aspect-[4/3] rounded-none" />
            <div className="space-y-2 p-3">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-5 w-24 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
