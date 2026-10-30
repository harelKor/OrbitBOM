"use client";

import { useState, useTransition } from "react";
import { toggleItemSeasonTag } from "@/app/(app)/inventory/actions";
import { useCan } from "@/components/shell/ModeContext";

type Tag = "2026" | "2027";

const TONE: Record<Tag, string> = { "2026": "bg-rose-600 hover:bg-rose-500", "2027": "bg-emerald-600 hover:bg-emerald-500" };

// The item's season tag: red 2026 (still from last season's list) or green 2027 (checked for this
// season). A tap flips it at once and saves in the background; a failed save flips it back.
// Without "work" it's a plain label. className sets the pill's size, to match the tags beside it.
export function SeasonTag({ itemId, tag, className = "rounded-full px-2 py-0.5 text-[11px]" }: { itemId: string; tag: Tag; className?: string }) {
  const work = useCan("work");
  const [shown, setShown] = useState(tag);
  const [seen, setSeen] = useState(tag);
  const [, start] = useTransition();
  if (seen !== tag) {
    setSeen(tag);
    setShown(tag);
  }
  const cls = `${className} font-mono font-semibold text-white tabular-nums shadow-sm ${TONE[shown]}`;
  if (!work) return <span className={cls}>{shown}</span>;
  return (
    <button
      type="button"
      title={shown === "2027" ? "Checked for 2027. Tap to mark it 2026" : "From the 2026 list. Tap to mark it checked for 2027"}
      aria-label={`Season ${shown}`}
      onClick={(e) => {
        e.stopPropagation();
        const next: Tag = shown === "2027" ? "2026" : "2027";
        setShown(next);
        start(async () => {
          const r = await toggleItemSeasonTag(itemId, next);
          if (r.error) setShown(shown);
        });
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`${cls} press cursor-pointer active:scale-[0.98]`}
    >
      {shown}
    </button>
  );
}
