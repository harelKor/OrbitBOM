"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addReviewComment, approveReviewComment, deleteReviewComment, rejectReviewComment, setReviewCommentDone, type CommentResult } from "@/app/(app)/review-comments-actions";
import { Dialog } from "@/components/Dialog";
import { LocalTime } from "@/components/ui/LocalTime";
import type { ReviewComment } from "@/lib/data/cadReview";

// One action at a time, the page refreshed after it, its error shown under the comment.
function useCommentAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<CommentResult>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) return setError(r.error);
      after?.();
      router.refresh();
    });
  return { pending, error, run };
}

function Meta({ c }: { c: ReviewComment }) {
  return (
    <span className="mt-0.5 block text-[11px] text-subtle">
      {c.author ?? "Someone"} · <LocalTime at={c.createdAt} />
    </span>
  );
}

function PartChip({ c, onFocus }: { c: ReviewComment; onFocus?: (key: string) => void }) {
  if (!c.partKey) return null;
  return (
    <button
      onClick={() => onFocus?.(c.partKey!)}
      className="press mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent-hover hover:bg-accent/20 pointer-coarse:min-h-8"
      title="Show the part"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      <span className="truncate">{c.partName ?? "A part"}</span>
    </button>
  );
}

// An open comment: its tick box ticks it off; a mentor's last rejection shows under it.
export function OpenComment({ c, systemId, canTick, canDelete, onFocus }: { c: ReviewComment; systemId: string; canTick: boolean; canDelete: boolean; onFocus?: (key: string) => void }) {
  const { pending, error, run } = useCommentAction();
  return (
    <li className={`rounded-md p-2 hover:bg-raised/70 ${pending ? "opacity-60" : ""}`}>
      <div className="flex gap-2.5">
        <input
          type="checkbox"
          checked={false}
          disabled={!canTick || pending}
          onChange={() => run(() => setReviewCommentDone(systemId, c.id, true))}
          aria-label="Tick off"
          title={canTick ? "Tick off: done" : "The CAD Team ticks comments off"}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
        />
        <div className="min-w-0 flex-1 text-sm">
          <button className="block w-full text-left whitespace-pre-wrap break-words text-fg" onClick={() => c.partKey && onFocus?.(c.partKey)}>
            {c.body}
          </button>
          <PartChip c={c} onFocus={onFocus} />
          <Meta c={c} />
          {c.rejectNote && (
            <p className="mt-1 rounded border border-rose-400/40 bg-rose-500/5 px-2 py-1 text-xs text-rose-600">
              Rejected{c.rejectedBy ? ` by ${c.rejectedBy}` : ""}: {c.rejectNote}
            </p>
          )}
          {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        </div>
        {canDelete && (
          <button
            onClick={() => confirm("Delete this comment?") && run(() => deleteReviewComment(c.id))}
            className="press self-start text-subtle hover:text-rose-500 pointer-coarse:min-h-9 pointer-coarse:min-w-9"
            aria-label="Delete comment"
            title="Delete"
          >
            ✕
          </button>
        )}
      </div>
    </li>
  );
}

// A ticked-off comment waiting for a mentor: Approve, or Reject with why (it opens again).
export function WaitingComment({ c, systemId, isMentor, canTick, onFocus }: { c: ReviewComment; systemId: string; isMentor: boolean; canTick: boolean; onFocus?: (key: string) => void }) {
  const { pending, error, run } = useCommentAction();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  return (
    <li className={`rounded-md p-2 hover:bg-raised/70 ${pending ? "opacity-60" : ""}`}>
      <div className="flex gap-2.5">
        <input
          type="checkbox"
          checked
          disabled={!canTick || pending}
          onChange={() => run(() => setReviewCommentDone(systemId, c.id, false))}
          aria-label="Take the tick back"
          title={canTick ? "Take the tick back" : "Ticked off"}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
        />
        <div className="min-w-0 flex-1 text-sm">
          <button className="block w-full text-left whitespace-pre-wrap break-words text-muted line-through" onClick={() => c.partKey && onFocus?.(c.partKey)}>
            {c.body}
          </button>
          <PartChip c={c} onFocus={onFocus} />
          <Meta c={c} />
          {c.doneAt && (
            <span className="block text-[11px] text-subtle">
              Ticked off{c.doneBy ? ` by ${c.doneBy}` : ""} · <LocalTime at={c.doneAt} />
            </span>
          )}
        </div>
      </div>
      {isMentor && !rejecting && (
        <div className="mt-2 flex gap-2 pl-6.5">
          <button className="btn-primary h-8 flex-1 justify-center text-xs active:scale-[0.98] pointer-coarse:h-9" disabled={pending} onClick={() => run(() => approveReviewComment(c.id))}>
            Approve
          </button>
          <button className="btn h-8 flex-1 justify-center text-xs active:scale-[0.98] pointer-coarse:h-9" disabled={pending} onClick={() => setRejecting(true)}>
            Reject
          </button>
        </div>
      )}
      {isMentor && rejecting && (
        <form
          className="mt-2 space-y-2 pl-6.5"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => rejectReviewComment(c.id, note), () => setRejecting(false));
          }}
        >
          <textarea autoFocus required value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input min-h-16 w-full text-sm" placeholder="Why isn't it done yet?" />
          <div className="flex gap-2">
            <button className="btn-danger h-8 flex-1 justify-center text-xs active:scale-[0.98] pointer-coarse:h-9" disabled={pending || !note.trim()}>
              Reject and reopen
            </button>
            <button type="button" className="btn h-8 justify-center text-xs pointer-coarse:h-9" onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-1 pl-6.5 text-xs text-rose-600">{error}</p>}
    </li>
  );
}

// A comment as the version tree lists it: its state, its text, a tap shows its part.
export function TreeComment({ c, onFocus }: { c: ReviewComment; onFocus?: (key: string) => void }) {
  const mark = c.state === "approved" ? { icon: "✓✓", cls: "text-emerald-600", title: `Approved${c.approvedBy ? ` by ${c.approvedBy}` : ""}` } : c.state === "done" ? { icon: "✓", cls: "text-sky-600", title: "Ticked off, waiting for a mentor" } : { icon: "○", cls: "text-amber-600", title: "Open" };
  return (
    <li>
      <button
        onClick={() => c.partKey && onFocus?.(c.partKey)}
        className={`press flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-raised pointer-coarse:min-h-9 ${c.partKey ? "" : "cursor-default"}`}
        title={mark.title}
      >
        <span className={`w-4 shrink-0 text-center font-bold ${mark.cls}`}>{mark.icon}</span>
        <span className={`min-w-0 flex-1 truncate ${c.state === "open" ? "text-fg-2" : "text-muted line-through"}`}>
          {c.partName && <span className="font-semibold">{c.partName}: </span>}
          {c.body}
        </span>
      </button>
    </li>
  );
}

// + Add comment: the text and, picked in the 3D view, the part it's about.
export function AddCommentDialog({
  open,
  onClose,
  systemId,
  part,
  onClearPart,
}: {
  open: boolean;
  onClose: () => void;
  systemId: string;
  part: { key: string; name: string | null } | null;
  onClearPart: () => void;
}) {
  const [body, setBody] = useState("");
  const { pending, error, run } = useCommentAction();
  return (
    <Dialog open={open} onClose={onClose} title="Add a comment" sheet>
      <form
        className="space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => addReviewComment(systemId, body, part),
            () => {
              setBody("");
              onClose();
            },
          );
        }}
      >
        {part ? (
          <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="min-w-0 flex-1 truncate font-semibold text-fg">{part.name ?? "A part placed in CAD"}</span>
            <button type="button" onClick={onClearPart} className="press text-xs text-muted hover:text-fg pointer-coarse:min-h-9">
              Not about a part
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted">Tap a part in the 3D view first to tie the comment to it.</p>
        )}
        <textarea autoFocus required value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} className="input min-h-28 w-full" placeholder="What should change?" />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button className="btn-primary w-full justify-center active:scale-[0.98]" disabled={pending || !body.trim()}>
          {pending ? "Saving…" : "Add comment"}
        </button>
      </form>
    </Dialog>
  );
}
