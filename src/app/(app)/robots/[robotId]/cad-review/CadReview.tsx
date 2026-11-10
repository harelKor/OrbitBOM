"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { TreeComment } from "@/components/review/Comments";
import { ReviewScreen, type ReviewPart } from "@/components/review/ReviewScreen";
import { VersionTree } from "@/components/review/VersionTree";
import { UpdateSystem } from "@/components/versions/UpdateSystem";
import type { RobotReview } from "@/lib/data/cadReview";
import type { Draft } from "@/lib/versions/detect";

export type IsolatedExtras = {
  systemId: string;
  assemblyUrl: string | null;
  lastSyncedAt: Date | null;
  draft: Draft | null;
  latest: { id: string; label: string } | null;
  partThumbs: Record<string, string | null>;
};

// CAD's page (Harel, 2026-11-09 and 2026-11-10): the whole robot. Its panel: the robot's own
// comments, then a section per system (its picture, Isolate, and its version tree when unfolded).
// Isolate scopes the page to that system the way its own page did: only its parts in 3D, its
// comments, Update system, its version tree and the Changes colours, with Whole robot to go back.
// The page shows it at once and the address (?system=) follows, so a reload or a shared link keeps it.
export function CadReview({
  robotId,
  robotName,
  review,
  parts,
  thumbs,
  builtAt,
  isolatedId,
  extras,
  me,
  canTick,
  canApprove,
  canSync,
}: {
  robotId: string;
  robotName: string;
  review: RobotReview;
  parts: ReviewPart[];
  thumbs: Record<string, string | null>;
  builtAt: string | null;
  isolatedId: string | null;
  extras: IsolatedExtras | null;
  me: { id: string; isAdmin: boolean; isMentor: boolean; onshape: boolean };
  canTick: boolean;
  canApprove: boolean;
  canSync: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // The isolated system: set at once on a tap, then kept in step with the address (Back, links).
  const [iso, setIso] = useState(isolatedId);
  const [seen, setSeen] = useState(isolatedId);
  if (seen !== isolatedId) {
    setSeen(isolatedId);
    setIso(isolatedId);
  }
  const isolate = (id: string | null) => {
    setIso(id);
    router.push(id ? `${pathname}?system=${id}` : pathname, { scroll: false });
  };

  const byId = useMemo(() => new Map(review.comments.map((c) => [c.id, c])), [review.comments]);
  const systems = useMemo(() => review.systems.map((s) => ({ id: s.id, name: s.name })), [review.systems]);
  const sys = iso ? review.systems.find((s) => s.id === iso) : undefined;
  const sysParts = useMemo(() => (sys ? parts.filter((p) => p.systemId === sys.id) : parts), [parts, sys]);
  const own = review.comments.filter((c) => !c.systemId).reverse();
  const extra = sys && extras?.systemId === sys.id ? extras : null;

  if (sys) {
    const comments = review.comments.filter((c) => c.systemId === sys.id);
    return (
      <ReviewScreen
        robotId={robotId}
        title={sys.name}
        back={{ label: `${robotName} · whole robot`, onClick: () => isolate(null) }}
        modelUrl={`/api/robots/${robotId}/model`}
        builtAt={builtAt}
        parts={sysParts}
        comments={comments}
        target={{ systemId: sys.id }}
        onlySystem={sys.id}
        me={me}
        canTick={canTick}
        canApprove={canApprove}
        changes={{ label: sys.current?.label ?? null, list: sys.changes }}
        panel={(onFocus, open) => (
          <>
            {extra?.assemblyUrl && (canSync || extra.draft) && (
              <Suspense>
                <UpdateSystem
                  systemId={sys.id}
                  draft={extra.draft}
                  lastSyncedAt={extra.lastSyncedAt}
                  thumbs={extra.partThumbs}
                  latest={extra.latest}
                  comments={open.map((c) => ({ id: c.id, body: c.body, partName: c.partName, author: c.author, createdAt: c.createdAt }))}
                  phone
                />
              </Suspense>
            )}
            <VersionTree tree={sys.tree} comments={byId} onFocus={onFocus} refresh={canSync && me.onshape && sys.treeDid ? { systemId: sys.id, readAt: sys.treeReadAt } : null} />
          </>
        )}
      />
    );
  }

  return (
    <ReviewScreen
      robotId={robotId}
      title={robotName}
      modelUrl={`/api/robots/${robotId}/model`}
      builtAt={builtAt}
      parts={parts}
      comments={review.comments}
      target={{ systems }}
      onlySystem={null}
      onIsolate={isolate}
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
              <Fold key={s.id} title={s.name} count={open} thumb={thumbs[s.id] ?? null} onIsolate={() => isolate(s.id)}>
                <VersionTree tree={s.tree} comments={byId} onFocus={onFocus} />
              </Fold>
            );
          })}
        </div>
      )}
    />
  );
}

// A panel section behind its own button; a system's has its picture and Isolate (Harel, 2026-11-10).
function Fold({ title, count, thumb, onIsolate, initial = false, children }: { title: string; count: number; thumb?: string | null; onIsolate?: () => void; initial?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="rounded-lg border border-line">
      <div className="flex items-center">
        <button onClick={() => setOpen(!open)} className="press flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left text-sm font-semibold text-fg hover:bg-raised active:scale-[0.98] pointer-coarse:min-h-11" aria-expanded={open}>
          {thumb !== undefined && (
            <span className="thumb-well flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
                <img src={thumb} alt="" loading="lazy" className="h-full w-full object-contain p-0.5" />
              ) : (
                <span className="text-[10px] text-subtle">No picture</span>
              )}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {count > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 tabular-nums">{count} open</span>}
          <span className={`text-xs text-subtle ${open ? "" : "rotate-180"}`}>▴</span>
        </button>
        {onIsolate && (
          <button onClick={onIsolate} className="btn mr-2 h-8 shrink-0 px-2.5 text-xs active:scale-[0.98] pointer-coarse:h-9" title={`Show only ${title}`}>
            Isolate
          </button>
        )}
      </div>
      {open && <div className="border-t border-line p-2">{children}</div>}
    </section>
  );
}
