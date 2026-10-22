"use client";

// The status Release gives the selected parts.
export const RELEASED_STATUS = "Released";

// Release on a system page: select parts, then Release marks them Released.
export function ReleaseBar({ count, total, onRelease, onSelectAll, onDone }: { count: number; total: number; onRelease: () => void; onSelectAll: () => void; onDone: () => void }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-surface/95 p-3 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold tabular-nums">{count} selected</span>
        <button className="btn-primary" disabled={!count} onClick={onRelease}>
          Release
        </button>
        <button className="btn" onClick={onSelectAll}>
          Select all (<span className="font-mono tabular-nums">{total}</span>)
        </button>
        <button className="btn ml-auto" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
