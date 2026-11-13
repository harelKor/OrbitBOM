"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useTransition } from "react";
import { addReviewComment, deleteReviewComment, setReviewCommentStatus, type CommentResult } from "@/app/(app)/review-comments-actions";
import { Popover } from "@/components/bom/Popover";
import { textOn } from "@/components/bom/options";
import { Dialog } from "@/components/Dialog";
import { LocalTime } from "@/components/ui/LocalTime";
import type { ReviewComment } from "@/lib/data/cadReview";
import { allowedStatuses, isActive, needsNote, statusOf, type CommentStatus } from "@/lib/reviews/status";
import { CommentSnip, SnipPicture, uploadSnip, type SnipDraft } from "./Snip";

// Who is looking, for the status pills, and the comment window the version tree opens (Harel,
// 2026-11-13). Set by the CAD page and the Onshape panel.
export type CommentCtx = {
  me: { id: string; isAdmin: boolean; isMentor: boolean };
  canTick: boolean; // CAD Team or mentor
  canApprove: boolean; // mentor, or an admin in Edit mode
  open?: (c: ReviewComment) => void; // the comment window
};
export const CommentContext = createContext<CommentCtx | null>(null);

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

// Lists that keep a comment whose status moved it out (struck through, where it was) until the
// page is left, so a tap doesn't make the list jump (Harel, 2026-11-13). `keep`: what belongs.
export function useStickyList(comments: ReviewComment[], keep: (c: ReviewComment) => boolean): { c: ReviewComment; gone: boolean }[] {
  const [seen, setSeen] = useState<Set<string>>(() => new Set(comments.filter(keep).map((c) => c.id)));
  const fresh = comments.filter((c) => keep(c) && !seen.has(c.id));
  if (fresh.length) setSeen(new Set([...seen, ...fresh.map((c) => c.id)]));
  return comments.filter((c) => keep(c) || seen.has(c.id)).map((c) => ({ c, gone: !keep(c) }));
}

// A status as a coloured pill.
export function CommentStatusPill({ status, caret = false }: { status: string; caret?: boolean }) {
  const s = statusOf(status);
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap" style={{ background: s.color, color: textOn(s.color) }} title={s.hint}>
      {s.label}
      {caret && (
        <span className="opacity-70" aria-hidden>
          ▾
        </span>
      )}
    </span>
  );
}

// The pill that changes the status, like a BOM part's: a tap lists what this member may pick. A
// mentor sending a To check one back writes why first.
export function StatusMenu({ c, onDone }: { c: ReviewComment; onDone?: () => void }) {
  const ctx = useContext(CommentContext);
  const { pending, error, run } = useCommentAction();
  const [asking, setAsking] = useState<CommentStatus | null>(null);
  const [note, setNote] = useState("");
  const who = { team: !!ctx?.canTick, approver: !!ctx?.canApprove, author: !!ctx && c.authorId === ctx.me.id };
  const choices = allowedStatuses(c.state, who);
  const pick = (to: CommentStatus, close: () => void) => {
    if (needsNote(c.state, to, { mentor: !!ctx?.me.isMentor })) return setAsking(to);
    close();
    run(() => setReviewCommentStatus(c.id, to), onDone);
  };
  return (
    <span className={`inline-flex flex-col ${pending ? "opacity-60" : ""}`}>
      <Popover locked={!choices.length || pending} hideCaret width={220} trigger={<CommentStatusPill status={c.state} caret={choices.length > 0} />} onClosed={() => setAsking(null)}>
        {(close) =>
          asking ? (
            <form
              className="space-y-2 p-1"
              onSubmit={(e) => {
                e.preventDefault();
                close();
                run(
                  () => setReviewCommentStatus(c.id, asking, note),
                  () => {
                    setNote("");
                    onDone?.();
                  },
                );
              }}
            >
              <p className="text-xs text-muted">Back to {statusOf(asking).label}: why isn&rsquo;t it done yet?</p>
              <textarea autoFocus required value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="input min-h-16 w-full text-sm" />
              <button className="btn-danger h-9 w-full justify-center text-xs active:scale-[0.98]" disabled={!note.trim()}>
                Send back
              </button>
            </form>
          ) : (
            <ul className="text-sm">
              {choices.map((k) => {
                const s = statusOf(k);
                return (
                  <li key={k}>
                    <button type="button" onClick={() => pick(k, close)} className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-fg-2 hover:bg-raised active:scale-[0.98]">
                      <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: s.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-fg">{s.label}</span>
                        <span className="block text-[0.6875rem] text-subtle">{s.hint}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        }
      </Popover>
      {error && <span className="mt-0.5 text-[0.6875rem] text-rose-600">{error}</span>}
    </span>
  );
}

function Meta({ c, where }: { c: ReviewComment; where?: boolean }) {
  return (
    <span className="mt-0.5 block text-[0.6875rem] text-subtle">
      {where && <span className="font-semibold text-fg-2">{c.systemName ?? "Robot"} · </span>}
      {c.model === "basepart" && <span className="mr-1 rounded bg-violet-500/15 px-1 py-px font-semibold text-violet-600 dark:text-violet-300" title="Written on the Basepart 3D model">Basepart</span>}
      {c.author ?? "Someone"} · <LocalTime at={c.createdAt} />
      {c.onshapeVersionId && <span title="Written in the Onshape panel on this Onshape version"> · on {c.onshapeVersionName || "an Onshape version"}</span>}
      {c.state === "on_it" && c.onItBy && <span className="font-semibold text-blue-600 dark:text-blue-400"> · {c.onItBy} is on it</span>}
    </span>
  );
}

function PartChip({ c, onFocus }: { c: ReviewComment; onFocus?: (key: string) => void }) {
  if (!c.partKey) return null;
  return (
    <button
      onClick={() => onFocus?.(c.partKey!)}
      className="press mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-accent-hover hover:bg-accent/20 pointer-coarse:min-h-8"
      title="Show the part"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      <span className="truncate">{c.partName ?? "A part"}</span>
    </button>
  );
}

// A tap on a comment's text turns the 3D view back to the one it was written in (`onView`, S6),
// else shows its part. `n`: its pin's number in the 3D view.
const tapText = (c: ReviewComment, onFocus?: (key: string) => void, onView?: (c: ReviewComment) => void) => () => (c.view && onView ? onView(c) : c.partKey && onFocus?.(c.partKey));

function PinBadge({ n, c, onView }: { n?: number; c: ReviewComment; onView?: (c: ReviewComment) => void }) {
  if (!n || !c.pin) return null;
  const color = statusOf(c.state).color;
  return (
    <button
      onClick={() => onView?.(c)}
      className="press mt-0.5 flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full px-1 text-[0.625rem] font-semibold tabular-nums shadow-sm pointer-coarse:h-6 pointer-coarse:min-w-6"
      style={{ background: color, color: textOn(color) }}
      title="Its pin in the 3D view: go to the view it was written in"
      aria-label={`Comment ${n}: go to its view`}
    >
      {n}
    </button>
  );
}

function Rejected({ c }: { c: ReviewComment }) {
  if (!c.rejectNote || !isActive(c.state)) return null;
  return (
    <p className="mt-1 rounded border border-rose-400/40 bg-rose-500/5 px-2 py-1 text-xs text-rose-600">
      Sent back{c.rejectedBy ? ` by ${c.rejectedBy}` : ""}: {c.rejectNote}
    </p>
  );
}

// A comment in a list: its status pill, its text (struck through once `gone`: its status took it
// out of this list while the page stays open), part, snip and who wrote it. `where`: show its
// system (or "Robot"), on the robot's page.
export function CommentRow({ c, n, gone = false, onFocus, onView, where }: { c: ReviewComment; n?: number; gone?: boolean; onFocus?: (key: string) => void; onView?: (c: ReviewComment) => void; where?: boolean }) {
  const ctx = useContext(CommentContext);
  const { pending, error, run } = useCommentAction();
  const canDelete = !!ctx && (ctx.me.isAdmin || (c.authorId === ctx.me.id && c.state === "open"));
  return (
    <li className={`rounded-md p-2 hover:bg-raised/70 ${pending ? "opacity-60" : ""}`}>
      <div className="flex gap-2.5">
        <PinBadge n={n} c={c} onView={onView} />
        <div className="min-w-0 flex-1 text-sm">
          <div className="mb-1 flex items-center gap-2">
            <StatusMenu c={c} />
            {ctx?.canApprove && c.state === "to_check" && (
              <button
                className="press rounded-full border border-emerald-500/50 px-2 py-0.5 text-[0.6875rem] font-semibold text-emerald-600 hover:bg-emerald-500/10 active:scale-[0.98] pointer-coarse:min-h-8"
                disabled={pending}
                onClick={() => run(() => setReviewCommentStatus(c.id, "done"))}
                title="Approve: Done"
              >
                ✓ Done
              </button>
            )}
          </div>
          <button className={`block w-full text-left whitespace-pre-wrap break-words ${gone ? "text-muted line-through" : "text-fg"}`} onClick={tapText(c, onFocus, onView)}>
            {c.body}
          </button>
          <PartChip c={c} onFocus={onFocus} />
          <CommentSnip c={c} />
          <Meta c={c} where={where} />
          {c.state === "to_check" && c.doneAt && (
            <span className="block text-[0.6875rem] text-subtle">
              To check{c.doneBy ? ` from ${c.doneBy}` : ""} · <LocalTime at={c.doneAt} />
            </span>
          )}
          <Rejected c={c} />
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

// A comment as the version tree lists it: its status, its text; a tap opens the comment window.
export function TreeComment({ c, onFocus }: { c: ReviewComment; onFocus?: (key: string) => void }) {
  const ctx = useContext(CommentContext);
  const s = statusOf(c.state);
  return (
    <li>
      <button
        onClick={() => (ctx?.open ? ctx.open(c) : c.partKey && onFocus?.(c.partKey))}
        className="press flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-raised pointer-coarse:min-h-9"
        title={`${s.label}: open the comment`}
      >
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
        <span className={`min-w-0 flex-1 truncate ${isActive(c.state) ? "text-fg-2" : "text-muted line-through"}`}>
          {c.partName && <span className="font-semibold">{c.partName}: </span>}
          {c.body}
          {c.snip && " 📷"}
        </span>
      </button>
    </li>
  );
}

// The comment window, from the version tree (Harel, 2026-11-13): the whole comment, its status to
// change, and what happened to it. Show in 3D turns the view to it.
export function CommentWindow({ c, onClose, onFocus, onView }: { c: ReviewComment; onClose: () => void; onFocus?: (key: string) => void; onView?: (c: ReviewComment) => void }) {
  const steps = [
    { label: "Written", by: c.author, at: c.createdAt },
    { label: "On it", by: c.onItBy, at: c.onItAt },
    { label: "To check", by: c.doneBy, at: c.doneAt },
    { label: "Done", by: c.approvedBy, at: c.approvedAt },
  ].filter((x): x is { label: string; by: string | null; at: string } => !!x.at);
  const show = tapText(c, onFocus, onView);
  return (
    <Dialog open onClose={onClose} title={c.systemName ? `Comment · ${c.systemName}` : "Comment · whole robot"} sheet>
      <div className="space-y-3 p-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusMenu c={c} />
          <PartChip
            c={c}
            onFocus={(k) => {
              onFocus?.(k);
              onClose();
            }}
          />
        </div>
        <p className="whitespace-pre-wrap break-words text-fg">{c.body}</p>
        <CommentSnip c={c} />
        <Rejected c={c} />
        <ul className="space-y-1 border-t border-line pt-2 text-xs text-muted">
          {steps.map((x) => (
            <li key={x.label} className="flex gap-2">
              <span className="w-16 shrink-0 font-semibold text-fg-2">{x.label}</span>
              <span>
                {x.by ?? "Someone"} · <LocalTime at={x.at} />
              </span>
            </li>
          ))}
          {c.onshapeVersionId && <li>Written on Onshape version {c.onshapeVersionName || "(unnamed)"}</li>}
        </ul>
        {(c.view || c.partKey) && (onView || onFocus) && (
          <button
            className="btn h-10 w-full justify-center active:scale-[0.98]"
            onClick={() => {
              show();
              onClose();
            }}
          >
            Show in 3D
          </button>
        )}
      </div>
    </Dialog>
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
  model = "final",
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
  model?: "basepart" | "final"; // the 3D model it's written on (Harel, 2026-11-12)
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
              return addReviewComment(robotId, systemId, body, part && { key: part.key, name: part.name }, null, shot, at ?? null, model);
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
