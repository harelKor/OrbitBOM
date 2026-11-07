"use client";

import Link from "next/link";

// The popup over a 3D view naming the part picked with a click: Open part, Open system (a link,
// left out where it would lead to the page you're on) and ✕ to clear it (Esc too).
export function PickedPart({
  name,
  onOpen,
  systemHref,
  onSystem,
  onClear,
  bottom = false,
}: {
  name: string | null; // null: placed in CAD, not on the BOM
  onOpen?: () => void;
  systemHref?: string;
  onSystem?: () => void;
  onClear: () => void;
  bottom?: boolean; // at the bottom, clear of a view's own buttons on top
}) {
  return (
    <div className={`absolute ${bottom ? "bottom-3" : "top-3"} left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 animate-pop flex-wrap items-center justify-center gap-2 rounded-md border border-accent/50 bg-surface/95 px-3 py-2 text-xs shadow-sm backdrop-blur`}>
      <span className="min-w-0 truncate font-semibold text-fg">{name ?? "Placed in CAD, not on the BOM"}</span>
      {name !== null && onOpen && (
        <button className="btn h-7 px-2.5 text-xs" onClick={onOpen} title="Or click the part again">
          Open part
        </button>
      )}
      {name !== null && systemHref && (
        <Link href={systemHref} onClick={onSystem} className="btn h-7 px-2.5 text-xs">
          Open system
        </Link>
      )}
      <button onClick={onClear} className="press text-muted hover:text-fg pointer-coarse:min-h-9 pointer-coarse:min-w-9" aria-label="Clear selection" title="Clear selection (Esc)">
        ✕
      </button>
    </div>
  );
}
