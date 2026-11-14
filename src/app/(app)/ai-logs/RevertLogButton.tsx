"use client";

import { useState, useTransition } from "react";
import { revertLog } from "./actions";
import { askConfirm } from "@/components/ui/useConfirm";
import { useManage } from "@/components/shell/ModeContext";

// Sits in a log's summary row: a click reverts the run without folding the row open or shut.
export function RevertLogButton({ batchId, what }: { batchId: string; what: string }) {
  const manage = useManage();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ error?: string; message?: string } | null>(null);
  // Only an admin in Edit mode can revert (revertLog checks "manage"): others don't see the button,
  // rather than a failure that read like a network error.
  if (!manage) return null;
  return (
    // Inside a <summary>: a click here must not fold the log open or shut.
    <span
      className="flex items-center gap-2"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {note && (
        <span role="status" className={`max-w-64 truncate text-xs ${note.error ? "text-rose-500" : "text-subtle"}`} title={note.error ?? note.message}>
          {note.error ?? note.message}
        </span>
      )}
      <button
        type="button"
        disabled={pending}
        className="btn px-2 py-0.5 text-xs active:scale-[0.98]"
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!(await askConfirm({ title: `Revert ${what}?`, body: "Everything it changed goes back to how it was before; fields edited again since are kept.", confirm: "Revert", danger: true }))) return;
          setNote(null);
          start(async () => {
            try {
              setNote(await revertLog(batchId));
            } catch {
              setNote({ error: "That didn't go through. Try again." });
            }
          });
        }}
      >
        {pending ? "Reverting…" : "Revert change"}
      </button>
    </span>
  );
}
