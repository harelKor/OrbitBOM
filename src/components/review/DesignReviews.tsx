"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { finishReviewAction, setCommentReviewAction, startReviewAction } from "@/app/(app)/review-comments-actions";
import { Popover } from "@/components/bom/Popover";
import { Dialog } from "@/components/Dialog";
import { LocalTime } from "@/components/ui/LocalTime";
import { toast } from "@/components/ui/Toaster";
import type { ReviewComment } from "@/lib/data/cadReview";
import type { DesignReview } from "@/lib/reviews/designReviews";

// Design Reviews on the CAD page (plan/cad-design-review.md, Harel 2026-11-18): Start DR / Finish DR
// beside the robot's name (admins), the DR tag on a comment, the DR's filter on the comments
// column, and ⋮ Add to DR….

const MAX_STATE = 2000;
export const versionText = (v: string | null) => v ?? "no version";
// "R7", or "R7 → R8" once Finish made a version.
export const versionsOf = (d: Pick<DesignReview, "version" | "finishVersion">) => (d.finishVersion ? `${versionText(d.version)} → ${d.finishVersion}` : versionText(d.version));

// Start DR, or Finish DR while one is open. Admins only (the page shows it to them; the server
// checks again).
// `compact`: the Onshape panel's narrow header (Harel, 2026-11-18).
export function DesignReviewButton({ robotId, systems, open, nextVersion, compact = false }: { robotId: string; systems: { id: string; name: string }[]; open: DesignReview | null; nextVersion: number; compact?: boolean }) {
  const [win, setWin] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setWin(true)}
        className={`press shrink-0 rounded-md font-semibold ${compact ? "h-7 px-2 text-xs pointer-coarse:h-9" : "h-9 px-3 text-sm"} active:scale-[0.98] ${open ? "border border-accent bg-accent/10 text-accent-hover hover:bg-accent/20" : "btn"}`}
        title={open ? `${open.name} is open: finish it` : "Start a Design Review"}
      >
        {open ? "Finish DR" : "Start DR"}
      </button>
      {win && (open ? <FinishWindow robotId={robotId} dr={open} nextVersion={nextVersion} onClose={() => setWin(false)} /> : <StartWindow robotId={robotId} systems={systems} onClose={() => setWin(false)} />)}
    </>
  );
}

function StartWindow({ robotId, systems, onClose }: { robotId: string; systems: { id: string; name: string }[]; onClose: () => void }) {
  const [whole, setWhole] = useState(true);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const ready = !!state.trim() && (whole || chosen.size > 0);
  return (
    <Dialog open onClose={() => !pending && onClose()} title="Start a Design Review">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await startReviewAction(robotId, { wholeRobot: whole, systemIds: whole ? [] : [...chosen], state });
            if (r.error) return setError(r.error);
            toast("Design Review started");
            router.refresh();
            onClose();
          });
        }}
      >
        <fieldset className="space-y-2">
          <legend className="label mb-1.5">Systems included</legend>
          <div className="grid grid-cols-2 gap-1 rounded-md bg-raised p-1" role="radiogroup" aria-label="Systems included">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                role="radio"
                aria-checked={whole === v}
                onClick={() => setWhole(v)}
                className={`press h-9 rounded text-sm font-semibold active:scale-[0.98] ${whole === v ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
              >
                {v ? "Whole robot" : "Choose systems"}
              </button>
            ))}
          </div>
          {!whole && (
            <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-line p-1">
              {systems.map((s) => (
                <li key={s.id}>
                  <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-raised">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={chosen.has(s.id)}
                      onChange={(e) => {
                        const next = new Set(chosen);
                        if (e.target.checked) next.add(s.id);
                        else next.delete(s.id);
                        setChosen(next);
                      }}
                    />
                    {s.name}
                  </label>
                </li>
              ))}
              {!systems.length && <li className="p-2 text-xs text-muted">The robot has no systems.</li>}
            </ul>
          )}
        </fieldset>
        <label className="block space-y-1.5">
          <span className="label">State</span>
          <textarea value={state} onChange={(e) => setState(e.target.value)} rows={4} maxLength={MAX_STATE} className="input min-h-24 w-full" placeholder="What's being reviewed, and where it's at" />
        </label>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn h-10 px-4 active:scale-[0.98]" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="btn-primary h-10 px-4 active:scale-[0.98]" disabled={pending || !ready}>
            {pending ? "Starting…" : "Start DR"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// Finish DR (Harel, 2026-11-18): optionally make a robot version for it, with its name. Cancel
// leaves the DR open.
function FinishWindow({ robotId, dr, nextVersion, onClose }: { robotId: string; dr: DesignReview; nextVersion: number; onClose: () => void }) {
  const [make, setMake] = useState(false);
  const [name, setName] = useState(`R${nextVersion}`);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open onClose={() => !pending && onClose()} title={`Finish ${dr.name}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setError(null);
            const r = await finishReviewAction(robotId, make ? name : null);
            if (r.error) return setError(r.error);
            toast(`${dr.name} finished`);
            router.refresh();
            onClose();
          });
        }}
      >
        <p className="text-sm text-fg-2">
          Started at robot version <span className="font-semibold text-fg">{versionText(dr.version)}</span>
          {dr.startedBy ? ` by ${dr.startedBy}` : ""}.
        </p>
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={make} onChange={(e) => setMake(e.target.checked)} />
          Create a robot version for it
        </label>
        {make && (
          <label className="block space-y-1.5">
            <span className="label">Version name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="input w-full" />
            <span className="block text-xs text-muted">Keeps every system as it is now, like Create version. No Onshape calls.</span>
          </label>
        )}
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn h-10 px-4 active:scale-[0.98]" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className="btn-primary h-10 px-4 active:scale-[0.98]" disabled={pending || (make && !name.trim())}>
            {pending ? "Finishing…" : "Confirm"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// The State text and its details, in the tag's popup and the filter's hover card.
function ReviewCard({ dr }: { dr: { name: string; version: string | null; state: string; open: boolean } & Partial<DesignReview> }) {
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-fg">{dr.name}</span>
        <span className="text-xs text-fg-2">· {dr.finishVersion !== undefined ? versionsOf({ version: dr.version, finishVersion: dr.finishVersion ?? null }) : versionText(dr.version)}</span>
        {dr.open && <span className="ml-auto rounded-full bg-accent/15 px-2 py-0.5 text-[0.6875rem] font-semibold text-accent-hover">Open</span>}
      </div>
      <p className="max-h-48 overflow-y-auto break-words whitespace-pre-wrap text-fg-2">{dr.state}</p>
      {dr.startedAt && (
        <p className="text-[0.6875rem] text-subtle">
          {dr.wholeRobot === false && dr.systems?.length ? `${dr.systems.map((s) => s.name).join(", ")} · ` : "Whole robot · "}
          Started <LocalTime at={dr.startedAt} style="ago" />
          {dr.startedBy ? ` by ${dr.startedBy}` : ""}
          {dr.finishedAt && (
            <>
              {" "}
              · finished <LocalTime at={dr.finishedAt} style="ago" />
            </>
          )}
        </p>
      )}
    </div>
  );
}

// "DR · R7" on a comment; a tap shows the DR's State (Harel, 2026-11-18).
export function ReviewTag({ c }: { c: ReviewComment }) {
  const dr = c.designReview;
  if (!dr) return null;
  return (
    <Popover
      hideCaret
      width={260}
      triggerClassName="press inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[0.6875rem] font-semibold text-sky-700 hover:bg-sky-500/25 dark:text-sky-300 pointer-coarse:min-h-8"
      trigger={<span title={`${dr.name}: tap for its state`}>DR · {versionText(dr.version)}</span>}
    >
      {() => (
        <div className="p-1">
          <ReviewCard dr={dr} />
        </div>
      )}
    </Popover>
  );
}

// The comments column's DR's ▾: all comments, or one DR's. Hovering a DR shows its State.
export function ReviewFilterMenu({ list, value, onChange }: { list: DesignReview[]; value: string | null; onChange: (id: string | null) => void }) {
  const [hover, setHover] = useState<{ dr: DesignReview; top: number; left: number } | null>(null);
  const now = list.find((d) => d.id === value);
  if (!list.length) return null;
  return (
    <Popover
      align="right"
      hideCaret
      width={240}
      onClosed={() => setHover(null)}
      triggerClassName={`press flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-semibold active:scale-[0.98] pointer-coarse:h-9 ${now ? "border-sky-500/60 bg-sky-500/10 text-sky-700 dark:text-sky-300" : "border-line bg-surface text-fg-2 hover:bg-raised hover:text-fg"}`}
      trigger={
        <span className="flex items-center gap-1" title="Show one Design Review's comments">
          {now ? now.name : "DR's"}
          <span aria-hidden className="text-subtle">▾</span>
        </span>
      }
    >
      {(close) => (
        <ul className="max-h-80 overflow-y-auto text-sm" role="listbox" aria-label="Design Reviews">
          {[null, ...list].map((d) => (
            <li key={d?.id ?? "all"}>
              <button
                type="button"
                role="option"
                aria-selected={(d?.id ?? null) === value}
                onMouseEnter={(e) => {
                  if (!d) return setHover(null);
                  const r = e.currentTarget.getBoundingClientRect();
                  const left = r.left - 268 >= 8 ? r.left - 268 : r.right + 8;
                  setHover({ dr: d, top: Math.min(r.top, window.innerHeight - 220), left });
                }}
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  close();
                  onChange(d?.id ?? null);
                }}
                className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-raised active:scale-[0.98] ${(d?.id ?? null) === value ? "font-semibold text-fg" : "text-fg-2"}`}
              >
                {d ? (
                  <>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${d.open ? "bg-sky-500" : "bg-line-strong"}`} title={d.open ? "Open" : "Finished"} />
                    <span className="shrink-0">{d.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-subtle">{versionsOf(d)}</span>
                  </>
                ) : (
                  <span className="flex-1">All comments</span>
                )}
                {(d?.id ?? null) === value && <span aria-hidden>✓</span>}
              </button>
            </li>
          ))}
          {hover && (
            // Fixed beside the list (the dropdown clips what's inside it).
            <div className="pointer-events-none fixed z-[70] w-64 rounded-lg border border-line-strong bg-surface p-3 shadow-xl" style={{ top: hover.top, left: hover.left }}>
              <ReviewCard dr={hover.dr} />
            </div>
          )}
        </ul>
      )}
    </Popover>
  );
}

// ⋮ Add to DR…: the robot's DRs, open first; the comment's own is ticked.
export function AddToReviewWindow({ c, list, onClose }: { c: ReviewComment; list: DesignReview[]; onClose: () => void }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const sorted = [...list].sort((a, b) => Number(b.open) - Number(a.open) || b.seq - a.seq);
  return (
    <Dialog open onClose={() => !pending && onClose()} title="Add to a Design Review">
      {sorted.length ? (
        <ul className="space-y-1">
          {sorted.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await setCommentReviewAction(c.id, d.id);
                    if (r.error) return setError(r.error);
                    toast(`Added to ${d.name}`);
                    router.refresh();
                    onClose();
                  })
                }
                className={`press flex min-h-11 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-raised active:scale-[0.98] ${c.designReview?.id === d.id ? "border-accent/60 bg-accent/5" : "border-line"}`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${d.open ? "bg-sky-500" : "bg-line-strong"}`} />
                <span className="font-semibold text-fg">{d.name}</span>
                <span className="text-xs text-fg-2">{versionsOf(d)}</span>
                <span className="min-w-0 flex-1 truncate text-right text-xs text-subtle">{d.state}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No Design Reviews on this robot yet. An admin starts one from Start DR beside the robot&rsquo;s name.</p>
      )}
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </Dialog>
  );
}

export async function removeFromReview(c: ReviewComment) {
  const r = await setCommentReviewAction(c.id, null);
  if (r.error) toast(r.error, true);
  else toast(`Taken out of ${c.designReview?.name ?? "the Design Review"}`);
}
