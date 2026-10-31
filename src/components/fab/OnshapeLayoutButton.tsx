"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { downloadExport } from "@/components/bom/downloadExport";
import { useCan } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { toast } from "@/components/ui/Toaster";
import type { Placement } from "@/lib/fab/layout";

// "Onshape Layout": puts the batch's nested parts in a "Batch - <name>" assembly in Onshape, flat
// with pockets up, and opens it in a new tab. Then "Batch .STEP" downloads that assembly as one
// file. Without `placements` (the batch header), the batch's automatic layout is used; inside the
// Auto Layout window, the layout as the member arranged it.
export function OnshapeLayoutButton({
  groupId,
  placements,
  url: savedUrl = null,
  compact = false,
}: {
  groupId: string;
  placements?: Placement[];
  url?: string | null;
  compact?: boolean;
}) {
  const work = useCan("work");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(savedUrl);
  const [stepBusy, setStepBusy] = useState(false);
  const shown = url ?? savedUrl;

  const push = async () => {
    // Open the tab now, while the click still counts, so the browser doesn't block it.
    const tab = window.open("", "_blank");
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/onshape-layout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(placements ? { placements: placements.map(({ partId, copy, x, y, rotation }) => ({ partId, copy, x, y, rotation })) } : {}),
      });
      if (!res.ok) {
        tab?.close();
        const reason = res.headers.get("content-type")?.startsWith("text/plain") ? (await res.text()).trim() : "";
        toast(reason || `Onshape Layout failed (${res.status}). Try again.`, true);
        return;
      }
      const out = (await res.json()) as { url: string; calls: number; copies: number; skipped: string[]; live: string[] };
      setUrl(out.url);
      if (tab) tab.location.href = out.url;
      else window.open(out.url, "_blank", "noopener");
      const notes = [
        out.skipped.length && `left out (no 3D model or not in Onshape): ${out.skipped.join(", ")}`,
        out.live.length && `from the live Part Studio: ${out.live.join(", ")}`,
      ].filter(Boolean);
      toast(`${out.copies} part${out.copies === 1 ? "" : "s"} laid out in Onshape (${out.calls} Onshape call${out.calls === 1 ? "" : "s"})${notes.length ? `. ${notes.join("; ")}` : "."}`, notes.length > 0);
      router.refresh();
    } catch {
      tab?.close();
      toast("Couldn't reach OrbitBOM. Check your connection and try again.", true);
    } finally {
      setBusy(false);
    }
  };

  const step = async () => {
    setStepBusy(true);
    await downloadExport(`/api/groups/${groupId}/onshape-layout/step`);
    setStepBusy(false);
  };

  const btn =
    "press flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-xs font-semibold text-fg-2 transition-colors hover:border-accent hover:text-accent active:scale-[0.98] disabled:opacity-50";
  return (
    <span className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {work && (
        <button
          className={btn}
          disabled={busy}
          onClick={() => void push()}
          title={shown ? "Lay the batch out again in its Onshape assembly" : "Make a Batch assembly in Onshape with every part flat, pockets up"}
        >
          <Icon name="cube" className="h-4 w-4" />
          {busy ? "Building in Onshape…" : compact ? "Onshape" : "Onshape Layout"}
        </button>
      )}
      {shown && (
        <>
          <a className={btn} href={shown} target="_blank" rel="noopener noreferrer" title="Open the batch's assembly in Onshape">
            <Icon name="link" className="h-4 w-4" />
            Open
          </a>
          <button className={btn} disabled={stepBusy} onClick={() => void step()} title="Download the batch's Onshape assembly as one STEP file">
            <Icon name="download" className="h-4 w-4" />
            {stepBusy ? "Preparing…" : "Batch .STEP"}
          </button>
        </>
      )}
    </span>
  );
}
