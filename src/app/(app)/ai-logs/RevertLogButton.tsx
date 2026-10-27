"use client";

import { useState, useTransition } from "react";
import { revertLog } from "./actions";

// Sits in a log's summary row: a click reverts the run without folding the row open or shut.
export function RevertLogButton({ batchId, what }: { batchId: string; what: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ error?: string; message?: string } | null>(null);
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
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!confirm(`Revert ${what}? Everything it changed goes back to how it was before; fields edited again since are kept.`)) return;
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
