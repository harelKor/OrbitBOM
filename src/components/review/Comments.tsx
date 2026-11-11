"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addReviewComment, approveReviewComment, deleteReviewComment, rejectReviewComment, setReviewCommentDone, type CommentResult } from "@/app/(app)/review-comments-actions";
import { Dialog } from "@/components/Dialog";
import { LocalTime } from "@/components/ui/LocalTime";
import type { ReviewComment } from "@/lib/data/cadReview";
import { CommentSnip, SnipPicture, uploadSnip, type SnipDraft } from "./Snip";

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

function Meta({ c, where }: { c: ReviewComment; where?: boolean }) {
  return (
    <span className="mt-0.5 block text-[11px] text-subtle">
      {where && <span className="font-semibold text-fg-2">{c.systemName ?? "Robot"} · </span>}
      {c.author ?? "Someone"} · <LocalTime at={c.createdAt} />
      {c.onshapeVersionId && <span title="Written in the Onshape panel on this Onshape version"> · on {c.onshapeVersionName || "an Onshape version"}</span>}
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
// `where`: show its system (or "Robot"), on the robot's page.
// A tap on a comment's text turns the 3D view back to the one it was written in (`onView`, S6),
// else shows its part. `n`: its pin's number in the 3D view.
const tapText = (c: ReviewComment, onFocus?: (key: string) => void, onView?: (c: ReviewComment) => void) => () => (c.view && onView ? onView(c) : c.partKey && onFocus?.(c.partKey));

function PinBadge({ n, c, onView }: { n?: number; c: ReviewComment; onView?: (c: ReviewComment) => void }) {
  if (!n || !c.pin) return null;
  return (
    <button
      onClick={() => onView?.(c)}
      className={`press mt-0.5 flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white tabular-nums shadow-sm pointer-coarse:h-6 pointer-coarse:min-w-6 ${c.state === "open" ? "bg-amber-500" : "bg-sky-500"}`}
      title="Its pin in the 3D view: go to the view it was written in"
      aria-label={`Comment ${n}: go to its view`}
    >
      {n}
    </button>
  );
}

export function OpenComment({ c, n, canTick, canDelete, onFocus, onView, where }: { c: ReviewComment; n?: number; canTick: boolean; canDelete: boolean; onFocus?: (key: string) => void; onView?: (c: ReviewComment) => void; where?: boolean }) {
  const { pending, error, run } = useCommentAction();
  return (
    <li className={`rounded-md p-2 hover:bg-raised/70 ${pending ? "opacity-60" : ""}`}>
      <div className="flex gap-2.5">
        <input
          type="checkbox"
          checked={false}
          disabled={!canTick || pending}
          onChange={() => run(() => setReviewCommentDone(c.id, true))}
          aria-label="Tick off"
          title={canTick ? "Tick off: done" : "The CAD Team ticks comments off"}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
        />
        <PinBadge n={n} c={c} onView={onView} />
        <div className="min-w-0 flex-1 text-sm">
          <button className="block w-full text-left whitespace-pre-wrap break-words text-fg" onClick={tapText(c, onFocus, onView)}>
            {c.body}
          </button>
          <PartChip c={c} onFocus={onFocus} />
          <CommentSnip c={c} />
          <Meta c={c} where={where} />
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
export function WaitingComment({ c, n, isMentor, canTick, onFocus, onView, where }: { c: ReviewComment; n?: number; isMentor: boolean; canTick: boolean; onFocus?: (key: string) => void; onView?: (c: ReviewComment) => void; where?: boolean }) {
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
          onChange={() => run(() => setReviewCommentDone(c.id, false))}
          aria-label="Take the tick back"
          title={canTick ? "Take the tick back" : "Ticked off"}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
        />
        <PinBadge n={n} c={c} onView={onView} />
        <div className="min-w-0 flex-1 text-sm">
          <button className="block w-full text-left whitespace-pre-wrap break-words text-muted line-through" onClick={tapText(c, onFocus, onView)}>
            {c.body}
          </button>
          <PartChip c={c} onFocus={onFocus} />
          <CommentSnip c={c} />
          <Meta c={c} where={where} />
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
          {c.snip && " 📷"}
        </span>
      </button>
    </li>
  );
}

// Where a comment goes: one system, or on the robot's page the choice of the whole robot or a
// system (the picked part's, else one picked from the list) (Harel, 2026-11-09).
export type CommentTarget = { systemId: string } | { systems: { id: string; name: string }[] };

// + Add comment: the text and, picked in the 3D view, the part it's about.
export function AddCommentDialog({
  open,
  onClose,
  robotId,
  target,
  part,
  onClearPart,
  snip,
  onSnip,
  onEditSnip,
  onRemoveSnip,
  at,
}: {
  open: boolean;
  onClose: () => void;
  robotId: string;
  target: CommentTarget;
  part: { key: string; name: string | null; systemId?: string | null } | null;
  onClearPart: () => void;
  snip: SnipDraft | null; // taken with Snip, uploaded on save
  onSnip: () => void; // take one (the window steps aside meanwhile)
  onEditSnip: () => void;
  onRemoveSnip: () => void;
  at?: { view: unknown; pin: [number, number, number] | null } | null; // the 3D view when it opened, and the newest pick's point (S6)
}) {
  const [body, setBody] = useState("");
  const { pending, error, run } = useCommentAction();
  const onRobot = "systems" in target;
  const [scope, setScope] = useState<"system" | "robot">(onRobot && !part?.systemId ? "robot" : "system");
  const [picked, setPicked] = useState("");
  const systemId = !onRobot ? target.systemId : scope === "robot" ? null : (part?.systemId ?? (picked || null));
  const missing = onRobot && scope === "system" && !systemId;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a comment"
      sheet
      actions={
        <button type="button" className="btn h-9 gap-1.5 px-3 text-sm active:scale-[0.98]" onClick={onSnip} title="Cut a picture out of the 3D view and draw on it">
          📷 Snip
        </button>
      }
    >
      <form
        className="space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            async () => {
              let shot = null;
              if (snip) {
                const up = await uploadSnip(snip);
                if ("error" in up) return up;
                shot = up.snip;
              }
              return addReviewComment(robotId, systemId, body, part && { key: part.key, name: part.name }, null, shot, at ?? null);
            },
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
        {onRobot && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1 rounded-md bg-raised p-1" role="radiogroup" aria-label="Where the comment goes">
              {(["system", "robot"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={scope === v}
                  onClick={() => setScope(v)}
                  className={`press h-9 rounded text-sm font-semibold active:scale-[0.98] ${scope === v ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
                >
                  {v === "system" ? "System" : "Robot"}
                </button>
              ))}
            </div>
            {scope === "system" &&
              (part?.systemId ? (
                <p className="text-xs text-muted">On {target.systems.find((s) => s.id === part.systemId)?.name ?? "the part's system"}, the part&rsquo;s system.</p>
              ) : (
                <select className="input w-full" value={picked} onChange={(e) => setPicked(e.target.value)} aria-label="System">
                  <option value="">Pick the system…</option>
                  {target.systems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ))}
            {scope === "robot" && <p className="text-xs text-muted">On the whole robot.</p>}
          </div>
        )}
        {snip && (
          <div className="flex items-start gap-3">
            <button type="button" onClick={onEditSnip} className="press w-40 shrink-0 overflow-hidden rounded border border-line hover:border-accent/60 active:scale-[0.98]" title="Draw on it">
              <SnipPicture src={snip.dataUrl} w={snip.w} h={snip.h} strokes={snip.strokes} />
            </button>
            <div className="flex flex-col gap-1 text-xs">
              <button type="button" onClick={onEditSnip} className="press text-left font-semibold text-accent-hover hover:underline pointer-coarse:min-h-9">
                Draw on it
              </button>
              <button type="button" onClick={onRemoveSnip} className="press text-left text-muted hover:text-rose-500 pointer-coarse:min-h-9">
                Remove snip
              </button>
            </div>
          </div>
        )}
        <textarea autoFocus required value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} className="input min-h-28 w-full" placeholder="What should change?" />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button className="btn-primary w-full justify-center active:scale-[0.98]" disabled={pending || !body.trim() || missing}>
          {pending ? "Saving…" : "Add comment"}
        </button>
      </form>
    </Dialog>
  );
}
