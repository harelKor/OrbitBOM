"use client";

import { CALL_COSTS, costHint } from "@/config/callCosts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { downloadExport } from "@/components/bom/downloadExport";
import { useCan } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { toast } from "@/components/ui/Toaster";
import type { LayoutPlacement } from "@/db/schema";

// A Fab batch's Onshape layout (src/lib/fab/onshapeLayout.ts).
// In the Auto Layout window: "Onshape Layout" (then "Update Onshape Layout") puts the parts as
// arranged into a "Batch - <name>" assembly, flat with pockets up, and opens it in a new tab.
// Once made, here and on the open batch card: "Open Layout" (a plain link) and "Export STEP".
export function OnshapeLayoutButton({
  groupId,
  placements,
  url: savedUrl = null,
  where = "card",
  onBusy,
  onDone,
}: {
  groupId: string;
  placements?: LayoutPlacement[];
  url?: string | null;
  where?: "card" | "dialog";
  onBusy?: (busy: boolean) => void;
  onDone?: (url: string) => void;
}) {
  const work = useCan("work");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const url = made ?? savedUrl;
  const [stepBusy, setStepBusy] = useState(false);

  const push = async () => {
    // The tab opens now, while the click still counts (a popup blocker would stop it after the
    // wait), with a message until the assembly is ready; it closes again if anything fails.
    const tab = window.open("about:blank", "_blank");
    if (tab) {
      tab.opener = null; // Onshape's page gets no hold on this one
      tab.document.title = "Creating Onshape Layout…";
      tab.document.body.style.cssText = "margin:0;height:100vh;display:grid;place-items:center;background:#07090E;color:#cbd5e1;font:600 16px system-ui,sans-serif";
      tab.document.body.textContent = "Creating the Onshape assembly for this batch…";
    }
    setBusy(true);
    setError(null);
    onBusy?.(true);
    let failed: string | null = null;
    try {
      const res = await fetch(`/api/groups/${groupId}/onshape-layout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(placements ? { placements: placements.map(({ partId, copy, x, y, rotation }) => ({ partId, copy, x, y, rotation })) } : {}),
      });
      if (!res.ok) {
        const reason = res.headers.get("content-type")?.startsWith("text/plain") ? (await res.text()).trim() : "";
        failed = reason || `Onshape Layout failed (${res.status}). Try again.`;
      } else {
        const out = (await res.json()) as { url: string; calls: number; copies: number; skipped: string[]; live: string[]; fellBack?: boolean };
        if (!/^https:\/\/[a-z0-9-]+\.onshape\.com\/documents\/[0-9a-f]{24}\/w\/[0-9a-f]{24}\/e\/[0-9a-f]{24}$/i.test(out.url)) {
          failed = "Onshape didn't return a link to the new assembly. Try again.";
        } else {
          setMade(out.url);
          onDone?.(out.url);
          if (tab && !tab.closed) tab.location.replace(out.url);
          const notes = [
            out.fellBack && "Onshape refused parts in the Batch Layouts document, so it's in the system's document",
            out.skipped.length > 0 && `left out (no 3D model or not in Onshape): ${out.skipped.join(", ")}`,
            out.live.length > 0 && `from the live Part Studio: ${out.live.join(", ")}`,
          ].filter(Boolean);
          toast(`${out.copies} part${out.copies === 1 ? "" : "s"} laid out in Onshape (${out.calls} Onshape call${out.calls === 1 ? "" : "s"})${notes.length ? `. ${notes.join("; ")}` : "."}`, notes.length > 0);
          router.refresh();
        }
      }
    } catch {
      failed = "Couldn't reach OrbitParts. Check your connection and try again.";
    }
    if (failed) {
      tab?.close();
      setError(failed);
      toast(failed, true);
    }
    setBusy(false);
    onBusy?.(false);
  };

  const step = async () => {
    setStepBusy(true);
    await downloadExport(`/api/groups/${groupId}/onshape-layout/step`, "POST");
    setStepBusy(false);
  };

  const btn =
    "press flex items-center gap-1 rounded-full border border-line-strong bg-surface px-2.5 py-1 text-xs font-bold text-fg-2 transition-colors duration-150 hover:border-sky-400/40 hover:text-sky-500 active:scale-[0.98] disabled:opacity-50";
  if (where === "card" && !url) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {where === "dialog" && work && (
        <button
          className={`${btn} border-accent text-accent`}
          disabled={busy || (placements !== undefined && placements.length === 0)}
          onClick={() => void push()}
          {...costHint(CALL_COSTS.onshapeLayout)}
          title={url ? "Move the parts in the Onshape assembly to this layout" : "Make a Batch assembly in Onshape with every part flat, pockets up"}
        >
          <Icon name="cube" className="h-3.5 w-3.5" />
          {busy ? "Creating Onshape Layout…" : url ? "Update Onshape Layout" : "Onshape Layout"}
        </button>
      )}
      {url && (
        <>
          <a className={btn} href={url} target="_blank" rel="noopener noreferrer" title="Open the batch's assembly in Onshape">
            <Icon name="link" className="h-3.5 w-3.5" />
            Open Layout
          </a>
          <button className={btn} disabled={stepBusy || busy} onClick={() => void step()} {...costHint(CALL_COSTS.layoutStep)} title="Download the batch's Onshape assembly as one STEP file">
            <Icon name="download" className="h-3.5 w-3.5" />
            {stepBusy ? "Preparing STEP…" : "Export STEP"}
          </button>
        </>
      )}
      {error && where === "dialog" && (
        <span role="alert" className="basis-full text-xs font-medium text-rose-600 dark:text-rose-400">
          {error}
        </span>
      )}
    </span>
  );
}
