"use client";

import { createContext, useContext, useState, useTransition } from "react";
import { addReviewComment, deleteReviewComment, deleteReviewReply, editReviewComment, editReviewReply, replyToReviewComment, setReviewCommentStatus, type CommentResult } from "@/app/(app)/review-comments-actions";
import { Popover } from "@/components/bom/Popover";
import { textOn } from "@/components/bom/options";
import { Dialog } from "@/components/Dialog";
import { LocalTime } from "@/components/ui/LocalTime";
import type { CommentReply, ReviewComment } from "@/lib/data/cadReview";
import { allowedStatuses, isActive, needsNote, statusOf, type CommentStatus } from "@/lib/reviews/status";
import { CommentSnip, SnipPicture, uploadSnip, type SnipDraft } from "./Snip";
import { askConfirm } from "@/components/ui/useConfirm";

// Who is looking, for the status pills, and the comment window the version tree opens (Harel,
// 2026-11-13). Set by the CAD page and the Onshape panel.
export type CommentCtx = {
  me: { id: string; isAdmin: boolean; isMentor: boolean };
  canTick: boolean; // CAD Team or mentor
  canApprove: boolean; // mentor, or an admin in Edit mode
  open?: (c: ReviewComment) => void; // the comment window
  reply?: ReplyAttach; // a snip and a linked part for the comment window's Reply box
};

// What the comment window's Reply box carries (Harel, 2026-11-17): a snip and a part picked in the
// 3D view. Both need the window out of the way, so the CAD page keeps them.
export type ReplyAttach = {
  part: { key: string; name: string | null } | null;
  snip: SnipDraft | null;
  takeSnip: () => void; // the window steps aside while it's taken
  editSnip: () => void;
  removeSnip: () => void;
  pickPart: () => void; // the window steps aside until a part is picked in 3D
  clearPart: () => void;
  reset: () => void; // after the reply is saved
};
export const CommentContext = createContext<CommentCtx | null>(null);

// One action at a time, its error shown under the comment. The action's reply already carries the
// page drawn again (it revalidates), so no second refresh here.
function useCommentAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<CommentResult>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) return setError(r.error);
      after?.();
    });
  return { pending, error, run };
}

// Lists that keep a comment whose status moved it out (struck through, where it was) until the
// page is left, so a tap doesn't make the list jump (Harel, 2026-11-13). `keep`: what belongs.
// `reset`: a new value (another filter chosen) starts over from what `keep` takes now.
export function useStickyList(comments: ReviewComment[], keep: (c: ReviewComment) => boolean, reset = ""): { c: ReviewComment; gone: boolean }[] {
  const [seen, setSeen] = useState<{ ids: Set<string>; reset: string }>(() => ({ ids: new Set(comments.filter(keep).map((c) => c.id)), reset }));
  if (seen.reset !== reset) {
    const ids = new Set(comments.filter(keep).map((c) => c.id));
    setSeen({ ids, reset });
    return comments.filter((c) => ids.has(c.id)).map((c) => ({ c, gone: false }));
  }
  const fresh = comments.filter((c) => keep(c) && !seen.ids.has(c.id));
  if (fresh.length) setSeen({ ids: new Set([...seen.ids, ...fresh.map((c) => c.id)]), reset });
  return comments.filter((c) => keep(c) || seen.ids.has(c.id)).map((c) => ({ c, gone: !keep(c) }));
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

// Comments laid out like Onshape's (Harel, 2026-11-13): a card with the author's picture, name and
// how long ago, where Onshape shows the branch the version it is on, the text, then its thread
// of replies and a Reply box. Our status pill takes the place of Onshape's resolve tick.

// The author's Google picture, else their initials on a colour of their own.
export function Avatar({ name, src, id, small = false }: { name: string | null; src?: string | null; id?: string | null; small?: boolean }) {
  const size = small ? "h-6 w-6 text-[0.625rem]" : "h-8 w-8 text-xs";
  if (src)
    // eslint-disable-next-line @next/next/no-img-element -- Google's picture link, no referrer or it refuses
    return <img src={src} alt="" referrerPolicy="no-referrer" className={`${size} shrink-0 rounded-full bg-raised object-cover`} />;
  const initials = (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  let hue = 0;
  for (const ch of id ?? name ?? "") hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-full font-semibold text-white`} style={{ background: `hsl(${hue} 55% 45%)` }} aria-hidden>
      {initials}
    </span>
  );
}

function When({ at, edited }: { at: string; edited?: string | null }) {
  return (
    <span className="text-[0.6875rem] text-subtle tabular-nums">
      <LocalTime at={at} style="ago" />
      {edited && <span title="Changed after it was posted"> · edited</span>}
    </span>
  );
}

// Where Onshape shows the branch: the version it is on. Amber when newer than the BOM's.
function VersionChip({ c }: { c: ReviewComment }) {
  if (!c.version) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${c.version.ahead ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-raised text-fg-2"}`}
      title={c.version.ahead ? "Written on a version newer than the one the BOM is on" : "The version it was written on"}
    >
      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <circle cx="4" cy="3.5" r="1.7" />
        <circle cx="4" cy="12.5" r="1.7" />
        <circle cx="12" cy="6" r="1.7" />
        <path d="M4 5.2v5.6M12 7.7c0 2.5-3 2.6-6.6 3.6" />
      </svg>
      {c.version.name}
      {c.version.ahead && <span aria-hidden>↑</span>}
    </span>
  );
}

function PartChip({ c, onFocus }: { c: ReviewComment; onFocus?: (key: string) => void }) {
  if (!c.partKey) return null;
  return (
    <button
      onClick={() => onFocus?.(c.partKey!)}
      className="press inline-flex max-w-full items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-accent-hover hover:bg-accent/20 pointer-coarse:min-h-8"
      title="Show the part"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      <span className="truncate">{c.partName ?? "A part"}</span>
    </button>
  );
}

// ⋯ beside the status: Edit and Delete, for whoever may.
function MoreMenu({ items }: { items: { label: string; danger?: boolean; run: () => void }[] }) {
  if (!items.length) return null;
  return (
    <Popover
      align="right"
      hideCaret
      width={150}
      triggerClassName="press -my-1 flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-raised hover:text-fg pointer-coarse:h-9 pointer-coarse:w-9"
      trigger={<span aria-label="More">⋯</span>}
    >
      {(close) => (
        <ul className="text-sm">
          {items.map((it) => (
            <li key={it.label}>
              <button
                type="button"
                onClick={() => {
                  close();
                  it.run();
                }}
                className={`flex min-h-9 w-full items-center rounded-md px-2.5 py-1.5 text-left hover:bg-raised active:scale-[0.98] ${it.danger ? "text-rose-600" : "text-fg-2"}`}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

// A text box that saves on Ctrl+Enter (⌘+Enter) and cancels on Escape: editing and replying.
function TextBox({ initial = "", placeholder, action, pending, onSave, onCancel, autoFocus = true }: { initial?: string; placeholder?: string; action: string; pending: boolean; onSave: (text: string) => void; onCancel?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState(initial);
  const save = () => text.trim() && onSave(text);
  return (
    <form
      className="mt-1.5 space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <textarea
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape" && onCancel) {
            e.stopPropagation();
            onCancel();
          }
        }}
        rows={Math.min(8, Math.max(2, text.split("\n").length))}
        maxLength={2000}
        className="input w-full resize-none text-sm"
      />
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto text-[0.625rem] text-subtle max-sm:hidden">Ctrl+Enter</span>
        {onCancel && (
          <button type="button" className="btn h-8 px-3 text-xs active:scale-[0.98]" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn-primary h-8 px-3 text-xs active:scale-[0.98]" disabled={pending || !text.trim() || text === initial}>
          {pending ? "Saving…" : action}
        </button>
      </div>
    </form>
  );
}

function ReplyItem({ r, onFocus }: { r: CommentReply; onFocus?: (key: string) => void }) {
  const ctx = useContext(CommentContext);
  const { pending, error, run } = useCommentAction();
  const [editing, setEditing] = useState(false);
  const mine = !!ctx && r.authorId === ctx.me.id;
  const items = [
    ...(mine ? [{ label: "Edit", run: () => setEditing(true) }] : []),
    ...(mine || ctx?.me.isAdmin ? [{ label: "Delete", danger: true, run: async () => (await askConfirm({ title: "Delete this reply?", confirm: "Delete", danger: true })) && run(() => deleteReviewReply(r.id)) }] : []),
  ];
  return (
    <li className={`flex gap-2 ${pending ? "opacity-60" : ""}`}>
      <Avatar name={r.author} src={r.authorAvatar} id={r.authorId} small />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-semibold text-fg">{r.author ?? "Someone"}</span>
          <When at={r.createdAt} edited={r.editedAt} />
          <span className="ml-auto">
            <MoreMenu items={items} />
          </span>
        </div>
        {editing ? (
          <TextBox initial={r.body} action="Save" pending={pending} onCancel={() => setEditing(false)} onSave={(t) => run(() => editReviewReply(r.id, t), () => setEditing(false))} />
        ) : (
          <p className="text-sm whitespace-pre-wrap break-words text-fg-2">{r.body}</p>
        )}
        {r.partKey && (
          <button
            onClick={() => onFocus?.(r.partKey!)}
            className="press mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[0.6875rem] font-semibold text-accent-hover hover:bg-accent/20 pointer-coarse:min-h-8"
            title="Show the part"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="truncate">{r.partName ?? "A part"}</span>
          </button>
        )}
        {r.snip && <ReplySnip snip={r.snip} />}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </li>
  );
}

// A reply's snip: its picture with its lines; a tap shows it big.
function ReplySnip({ snip }: { snip: NonNullable<CommentReply["snip"]> }) {
  const [big, setBig] = useState(false);
  return (
    <>
      <button onClick={() => setBig(true)} className="press mt-1 block w-32 overflow-hidden rounded border border-line hover:border-accent/60 active:scale-[0.98]" title="Open the snip">
        <SnipPicture src={snip.url} w={snip.w} h={snip.h} strokes={snip.strokes} />
      </button>
      {big && (
        <Dialog open onClose={() => setBig(false)} title="Snip" width="w-[min(60rem,calc(100vw-2rem))]">
          <div className="p-3">
            <SnipPicture src={snip.url} w={snip.w} h={snip.h} strokes={snip.strokes} />
          </div>
        </Dialog>
      )}
    </>
  );
}

// The Reply box's snip and part (comment window only): buttons to add them, and what's added.
function ReplyExtras({ a }: { a: ReplyAttach }) {
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn h-8 gap-1 px-2.5 text-xs active:scale-[0.98] pointer-coarse:h-9" onClick={a.takeSnip} title="Cut a picture out of the 3D view and draw on it">
          📷 {a.snip ? "New snip" : "Snip"}
        </button>
        <button type="button" className="btn h-8 gap-1 px-2.5 text-xs active:scale-[0.98] pointer-coarse:h-9" onClick={a.pickPart} title="Pick the part in the 3D view">
          🔗 {a.part ? "Other part" : "Link part"}
        </button>
      </div>
      {a.part && (
        <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-2.5 py-1.5 text-xs">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="min-w-0 flex-1 truncate font-semibold text-fg">{a.part.name ?? "A part placed in CAD"}</span>
          <button type="button" onClick={a.clearPart} className="press text-muted hover:text-fg pointer-coarse:min-h-9" aria-label="Remove the part">
            ✕
          </button>
        </div>
      )}
      {a.snip && (
        <div className="flex items-start gap-2">
          <button type="button" onClick={a.editSnip} className="press w-28 shrink-0 overflow-hidden rounded border border-line hover:border-accent/60 active:scale-[0.98]" title="Draw on it">
            <SnipPicture src={a.snip.dataUrl} w={a.snip.w} h={a.snip.h} strokes={a.snip.strokes} />
          </button>
          <div className="flex flex-col gap-1 text-xs">
            <button type="button" onClick={a.editSnip} className="press text-left font-semibold text-accent-hover hover:underline pointer-coarse:min-h-9">
              Draw on it
            </button>
            <button type="button" onClick={a.removeSnip} className="press text-left text-muted hover:text-rose-500 pointer-coarse:min-h-9">
              Remove snip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// The thread: folds away behind its "▸ 3 replies" line (Harel, 2026-11-17), folded in lists and
// open in the comment window; the Reply box (open in the comment window, a "Reply" link in lists).
function Thread({ c, full, onFocus }: { c: ReviewComment; full: boolean; onFocus?: (key: string) => void }) {
  const ctx = useContext(CommentContext);
  const attach = full ? ctx?.reply : undefined;
  const { pending, error, run } = useCommentAction();
  const [open, setOpen] = useState(full);
  const [replying, setReplying] = useState(false);
  const [box, setBox] = useState(0); // a fresh box after each reply
  const n = c.replies.length;
  return (
    <div className="mt-2">
      {n > 0 && (
        <button className="press flex items-center gap-1 text-xs font-semibold text-fg-2 hover:text-fg pointer-coarse:min-h-8" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span aria-hidden className={`inline-block text-subtle transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
          {n} {n === 1 ? "reply" : "replies"}
        </button>
      )}
      {n > 0 && open && (
        <ul className="mt-1.5 space-y-2 border-l-2 border-line pl-2.5">
          {c.replies.map((r) => (
            <ReplyItem key={r.id} r={r} onFocus={onFocus} />
          ))}
        </ul>
      )}
      {attach && <ReplyExtras a={attach} />}
      {full || replying ? (
        <TextBox
          key={box}
          placeholder="Reply…"
          action="Reply"
          autoFocus={!full}
          pending={pending}
          onCancel={full ? undefined : () => setReplying(false)}
          onSave={(t) =>
            run(
              async () => {
                let shot = null;
                if (attach?.snip) {
                  const up = await uploadSnip(attach.snip);
                  if ("error" in up) return up;
                  shot = up.snip;
                }
                return replyToReviewComment(c.id, t, attach?.part ?? null, shot);
              },
              () => {
                attach?.reset();
                setBox((k) => k + 1);
                setReplying(false);
                setOpen(true);
              },
            )
          }
        />
      ) : (
        <button className="press mt-1 text-xs font-semibold text-accent-hover hover:underline pointer-coarse:min-h-8" onClick={() => setReplying(true)}>
          Reply
        </button>
      )}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

// A comment's card. In a list (`gone`: its status took it out of this list while the page stays
// open, so it stays struck through) a tap on its text opens the comment window; `full` is that
// window's card, with the whole thread and the Reply box open. `n`: its pin's number in the 3D
// view. `where`: show its system (or "Robot"), on the robot's page.
export function CommentRow({
  c,
  n,
  gone = false,
  full = false,
  onFocus,
  onView,
  where,
}: {
  c: ReviewComment;
  n?: number;
  gone?: boolean;
  full?: boolean;
  onFocus?: (key: string) => void;
  onView?: (c: ReviewComment) => void;
  where?: boolean;
}) {
  const ctx = useContext(CommentContext);
  const { pending, error, run } = useCommentAction();
  const [editing, setEditing] = useState(false);
  const mine = !!ctx && c.authorId === ctx.me.id;
  const items = [
    ...(mine ? [{ label: "Edit", run: () => setEditing(true) }] : []),
    ...(ctx && (ctx.me.isAdmin || (mine && c.state === "open")) ? [{ label: "Delete", danger: true, run: async () => (await askConfirm({ title: "Delete this comment and its replies?", confirm: "Delete", danger: true })) && run(() => deleteReviewComment(c.id)) }] : []),
  ];
  const pin = n && c.pin ? statusOf(c.state).color : null;
  const tappable = !full && !!ctx?.open;
  const bodyClass = `mt-1.5 block w-full text-left whitespace-pre-wrap break-words ${gone ? "text-muted line-through" : "text-fg"}`;
  return (
    // A light tint under the pointer (Harel, 2026-11-18).
    <li className={`${full ? "" : "mb-2.5 rounded-lg border border-line-strong bg-surface p-2.5 shadow-[0_1px_3px_rgb(0_0_0/0.12)] transition-colors duration-100 last:mb-0 hover:border-accent/40 hover:bg-accent/5"} list-none ${pending ? "opacity-60" : ""}`}>
      <div className="flex gap-2.5">
        <div className="relative h-8 shrink-0">
          <Avatar name={c.author} src={c.authorAvatar} id={c.authorId} />
          {pin && (
            <button
              onClick={() => onView?.(c)}
              className="press absolute -right-1.5 -bottom-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[0.625rem] font-semibold tabular-nums ring-2 ring-surface pointer-coarse:h-6 pointer-coarse:min-w-6"
              style={{ background: pin, color: textOn(pin) }}
              title="Its pin in the 3D view: go to the view it was written in"
              aria-label={`Comment ${n}: go to its view`}
            >
              {n}
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 truncate font-semibold text-fg">{c.author ?? "Someone"}</span>
            <When at={c.createdAt} edited={c.editedAt} />
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <StatusMenu c={c} />
              <MoreMenu items={items} />
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {where && <span className="rounded-full bg-raised px-2 py-0.5 text-[0.6875rem] font-semibold text-fg-2">{c.systemName ?? "Robot"}</span>}
            <VersionChip c={c} />
            {c.model === "basepart" && (
              <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[0.6875rem] font-semibold text-violet-600 dark:text-violet-300" title="Written on the Basepart 3D model">
                Basepart
              </span>
            )}
            <PartChip c={c} onFocus={onFocus} />
          </div>
          {editing ? (
            <TextBox initial={c.body} action="Save" pending={pending} onCancel={() => setEditing(false)} onSave={(t) => run(() => editReviewComment(c.id, t), () => setEditing(false))} />
          ) : (
            tappable ? (
              <button className={`${bodyClass} press`} onClick={() => ctx?.open?.(c)} title="Open the comment">
                {c.body}
              </button>
            ) : (
              <p className={bodyClass}>{c.body}</p>
            )
          )}
          <CommentSnip c={c} />
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-subtle">
            {c.state === "on_it" && c.onItBy && <span className="font-semibold text-blue-600 dark:text-blue-400">{c.onItBy} is on it</span>}
            {c.state === "to_check" && c.doneAt && (
              <span>
                To check{c.doneBy ? ` from ${c.doneBy}` : ""} · <LocalTime at={c.doneAt} style="ago" />
              </span>
            )}
            {ctx?.canApprove && c.state === "to_check" && (
              <button
                className="press rounded-full border border-emerald-500/50 px-2 py-0.5 font-semibold text-emerald-600 hover:bg-emerald-500/10 active:scale-[0.98] pointer-coarse:min-h-8"
                disabled={pending}
                onClick={() => run(() => setReviewCommentStatus(c.id, "done"))}
                title="Approve: Done"
              >
                ✓ Done
              </button>
            )}
          </div>
          {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
          <Thread c={c} full={full} onFocus={onFocus} />
        </div>
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
          {c.replies.length > 0 && <span className="text-subtle"> · 💬 {c.replies.length}</span>}
        </span>
      </button>
    </li>
  );
}

// The comment window (Harel, 2026-11-13): the comment's card with its whole thread and the Reply
// box, and what happened to it.
export function CommentWindow({ c, onClose, onFocus, onView, open = true }: { c: ReviewComment; onClose: () => void; onFocus?: (key: string) => void; onView?: (c: ReviewComment) => void; open?: boolean }) {
  const steps = [
    { label: "On it", by: c.onItBy, at: c.onItAt },
    { label: "To check", by: c.doneBy, at: c.doneAt },
    { label: "Done", by: c.approvedBy, at: c.approvedAt },
  ].filter((x): x is { label: string; by: string | null; at: string } => !!x.at);

  return (
    <Dialog open={open} onClose={onClose} title={c.systemName ? `Comment · ${c.systemName}` : "Comment · whole robot"} sheet>
      <div className="space-y-3 p-4 text-sm">
        <ul>
          <CommentRow
            c={c}
            full
            onFocus={
              onFocus &&
              ((k) => {
                onFocus(k);
                onClose();
              })
            }
            onView={
              onView &&
              ((x) => {
                onView(x);
                onClose();
              })
            }
          />
        </ul>
        {steps.length > 0 && (
          <ul className="space-y-1 border-t border-line pt-2 text-xs text-muted">
            {steps.map((x) => (
              <li key={x.label} className="flex gap-2">
                <span className="w-16 shrink-0 font-semibold text-fg-2">{x.label}</span>
                <span>
                  {x.by ?? "Someone"} · <LocalTime at={x.at} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

// Where a comment goes: one system, or on the robot's page the choice of the whole robot or a
// system (the picked part's, else one picked from the list) (Harel, 2026-11-09).
const FLOATING =
  "absolute top-3 left-3 z-30 m-0 max-h-[calc(100%-1.5rem)]! shadow-xl max-lg:top-16 max-sm:top-auto! max-sm:bottom-0 max-sm:left-0 max-sm:w-full! max-sm:max-h-[55%]! max-sm:rounded-b-none";

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
  initialBody = "",
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
  at?: () => { view: unknown; pin: [number, number, number] | null } | null; // the 3D view as it is when saved, and the newest pick's point (S6)
  model?: "basepart" | "final"; // the 3D model it's written on (Harel, 2026-11-12)
  initialBody?: string; // a Design check finding's words, to edit before saving
}) {
  const [body, setBody] = useState(initialBody);
  const { pending, error, run } = useCommentAction();
  const onRobot = "systems" in target;
  const [scope, setScope] = useState<"system" | "robot">(onRobot && !part?.systemId ? "robot" : "system");
  // A part picked while the window is open (it doesn't block the 3D view): its system takes it.
  const [scopedFor, setScopedFor] = useState(part?.key ?? null);
  if ((part?.key ?? null) !== scopedFor) {
    setScopedFor(part?.key ?? null);
    if (part?.systemId) setScope("system");
  }
  const [picked, setPicked] = useState("");
  const systemId = !onRobot ? target.systemId : scope === "robot" ? null : (part?.systemId ?? (picked || null));
  const missing = onRobot && scope === "system" && !systemId;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a comment"
      // Top left of the 3D view, no blur: the model can still be turned and picked while writing
      // (Harel, 2026-11-18). Phones: a low sheet at the bottom, the view above it.
      floating={FLOATING}
      width="w-[min(22rem,calc(100%-1.5rem))]"
      actions={
        <button type="button" className="btn h-9 gap-1.5 px-3 text-sm active:scale-[0.98]" onClick={onSnip} title="Cut a picture out of the 3D view and draw on it">
          📷 Snip
        </button>
      }
    >
      <form
        className="-m-5 space-y-3 p-4"
        // Esc closes it only while nothing is written: a comment isn't lost to a key press.
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          if (!body.trim() && !snip) onClose();
        }}
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
              return addReviewComment(robotId, systemId, body, part && { key: part.key, name: part.name }, null, shot, at?.() ?? null, model);
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
          <p className="text-xs text-muted">Tap a part in the 3D view to tie the comment to it.</p>
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
        <textarea
          autoFocus
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={4} maxLength={2000} className="input min-h-28 w-full" placeholder="What should change?" />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button className="btn-primary w-full justify-center active:scale-[0.98]" disabled={pending || !body.trim() || missing}>
          {pending ? "Saving…" : "Add comment"}
        </button>
      </form>
    </Dialog>
  );
}
