"use client";

import { useMemo, useState } from "react";
import { TreeComment } from "@/components/review/Comments";
import { ReviewScreen, type ReviewPart } from "@/components/review/ReviewScreen";
import { VersionTree } from "@/components/review/VersionTree";
import type { RobotReview as Review } from "@/lib/data/cadReview";

// The robot's CAD page (Harel, 2026-11-09). Its panel: Comments (the ones on the whole robot) and
// a button per system that unfolds that system's version tree.
export function RobotReview({
  robotId,
  robotName,
  review,
  parts,
  builtAt,
  me,
  canTick,
  canApprove,
}: {
  robotId: string;
  robotName: string;
  review: Review;
  parts: ReviewPart[];
  builtAt: string | null;
  me: { id: string; isAdmin: boolean; isMentor: boolean };
  canTick: boolean;
  canApprove: boolean;
}) {
  const byId = useMemo(() => new Map(review.comments.map((c) => [c.id, c])), [review.comments]);
  const own = review.comments.filter((c) => !c.systemId).reverse();
  const systems = useMemo(() => review.systems.map((s) => ({ id: s.id, name: s.name })), [review.systems]);
  return (
    <ReviewScreen
      robotId={robotId}
      title={robotName}
      back={{ href: `/robots/${robotId}/cad-review`, label: "CAD" }}
      modelUrl={`/api/robots/${robotId}/model`}
      builtAt={builtAt}
      parts={parts}
      comments={review.comments}
      target={{ systems }}
      me={me}
      canTick={canTick}
      canApprove={canApprove}
      panel={(onFocus) => (
        <div className="space-y-2">
          <Fold title="Robot comments" count={own.length} initial>
            {own.length ? (
              <ul>
                {own.map((c) => (
                  <TreeComment key={c.id} c={c} onFocus={onFocus} />
                ))}
              </ul>
            ) : (
              <p className="px-1.5 text-xs text-muted">No comments on the whole robot yet.</p>
            )}
          </Fold>
          {review.systems.map((s) => {
            const open = review.comments.filter((c) => c.systemId === s.id && c.state === "open").length;
            return (
              <Fold key={s.id} title={s.name} count={open}>
                <VersionTree tree={s.tree} comments={byId} onFocus={onFocus} />
              </Fold>
            );
          })}
        </div>
      )}
    />
  );
}

// A panel section behind its own button.
function Fold({ title, count, initial = false, children }: { title: string; count: number; initial?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="rounded-lg border border-line">
      <button onClick={() => setOpen(!open)} className="press flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-fg hover:bg-raised active:scale-[0.98] pointer-coarse:min-h-11" aria-expanded={open}>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {count > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 tabular-nums">{count} open</span>}
        <span className={`text-xs text-subtle ${open ? "" : "rotate-180"}`}>▴</span>
      </button>
      {open && <div className="border-t border-line p-2">{children}</div>}
    </section>
  );
}
