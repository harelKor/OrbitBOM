"use client";

// The order pages' own names and merged lines (Harel, 2026-11-20). On Released a small pencil
// beside the name renames the order line for the Released and Order List pages only (the BOM, To
// Fab and Onshape keep the part's name); the editor offers the BOM part's name to go back to.
// Parts merged on Released show as one line, tagged Merged, with their pictures side by side.

import { Popover } from "@/components/bom/Popover";
import { Icon } from "@/components/ui/Icon";
import { collageGrid } from "@/components/fab/BatchCard";
import { useState } from "react";

// What a card or row shows for its order line.
export type OrderLine = {
  title: string;
  bomName: string; // the BOM part's own name (the first part's, on a merged line)
  renamed: boolean; // it has a name of its own on the order pages
  onRename?: (name: string | null) => void; // Released, for members who can work
  merged?: { count: number; thumbs: (string | null)[]; onUnmerge?: () => void };
};

export function OrderNameEdit({ line }: { line: OrderLine }) {
  if (!line.onRename) return null;
  const rename = line.onRename;
  return (
    <Popover
      hideCaret
      align="right"
      triggerClassName="press shrink-0 rounded p-1 text-subtle hover:text-fg pointer-coarse:p-2"
      trigger={
        <span title="Rename on the order pages" aria-label="Rename on the order pages">
          <Icon name="pencil" className="h-3.5 w-3.5" />
        </span>
      }
    >
      {(close) => <RenameForm line={line} onDone={close} rename={rename} />}
    </Popover>
  );
}

export function RenameForm({ line, rename, onDone }: { line: OrderLine; rename: (name: string | null) => void; onDone: () => void }) {
  const [v, setV] = useState(line.title);
  const save = (name: string | null) => {
    rename(name);
    onDone();
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(v.trim() || null);
      }}
      className="space-y-2 text-sm"
    >
      <p className="text-xs text-subtle">The name on Released and the Order List only.</p>
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} className="input" aria-label="Order name" maxLength={200} />
      {/* Back to the BOM part's own name (Harel, 2026-11-20). */}
      {v.trim() !== line.bomName && (
        <button type="button" onClick={() => save(line.bomName)} className="press flex w-full items-center gap-2 rounded-md border border-line-strong bg-raised px-2 py-1.5 text-left text-xs hover:border-accent/60 pointer-coarse:min-h-9">
          <span className="text-subtle">↺ BOM name:</span>
          <span className="min-w-0 flex-1 truncate font-medium text-fg">{line.bomName}</span>
        </button>
      )}
      <div className="flex justify-end gap-2">
        {line.renamed && (
          <button type="button" className="btn mr-auto" onClick={() => save(null)} title="Show the inventory item's (or the part's) name again">
            Reset
          </button>
        )}
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn-primary">
          Save
        </button>
      </div>
    </form>
  );
}

// The Merged tag on a merged line's picture.
export function OrderMergedTag({ count }: { count: number }) {
  return (
    <span className="rounded-full border border-accent/40 bg-surface/95 px-2 py-0.5 text-[0.6875rem] leading-none font-bold text-accent shadow-sm tabular-nums" title={`${count} parts ordered as one`}>
      ⧉ Merged · {count}
    </span>
  );
}

// A merged line's pictures, side by side like a fab batch's.
export function OrderCollage({ thumbs }: { thumbs: (string | null)[] }) {
  const shown = thumbs.slice(0, 9);
  return (
    <div className="grid h-full w-full gap-0.5 p-1" style={collageGrid(shown.length)}>
      {shown.map((url, i) => (
        <div key={i} className="flex min-h-0 min-w-0 items-center justify-center">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
            <img src={url} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
          ) : (
            <span className="text-[0.625rem] text-muted">No picture</span>
          )}
        </div>
      ))}
    </div>
  );
}
