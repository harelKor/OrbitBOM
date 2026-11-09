"use client";

import { Suspense, useMemo } from "react";
import { ReviewScreen, type ReviewPart } from "@/components/review/ReviewScreen";
import { VersionTree } from "@/components/review/VersionTree";
import { UpdateSystem } from "@/components/versions/UpdateSystem";
import type { SystemReview as Review } from "@/lib/data/cadReview";
import type { Draft } from "@/lib/versions/detect";

// A system's CAD page (Harel, 2026-11-08): the review screen with Update system and the system's
// version tree in its panel, and the Changes colours for its current BOM version.
export function SystemReview({
  robotId,
  robotName,
  system,
  review,
  parts,
  thumbs,
  builtAt,
  draft,
  latest,
  me,
  canTick,
  canSync,
  canApprove,
}: {
  robotId: string;
  robotName: string;
  system: { id: string; name: string; assemblyUrl: string | null; lastSyncedAt: Date | null };
  review: Review;
  parts: ReviewPart[];
  thumbs: Record<string, string | null>;
  builtAt: string | null;
  draft: Draft | null;
  latest: { id: string; label: string } | null;
  me: { id: string; isAdmin: boolean; isMentor: boolean; onshape: boolean };
  canTick: boolean;
  canSync: boolean;
  canApprove: boolean; // a mentor, or an admin in Edit mode
}) {
  const byId = useMemo(() => new Map(review.comments.map((c) => [c.id, c])), [review.comments]);
  return (
    <ReviewScreen
      robotId={robotId}
      title={system.name}
      back={{ href: `/robots/${robotId}/cad-review`, label: `CAD · ${robotName}` }}
      modelUrl={`/api/robots/${robotId}/model?system=${system.id}`}
      builtAt={builtAt}
      parts={parts}
      comments={review.comments}
      target={{ systemId: system.id }}
      me={me}
      canTick={canTick}
      canApprove={canApprove}
      changes={{ label: review.current?.label ?? null, list: review.changes }}
      panel={(onFocus, open) => (
        <>
          {system.assemblyUrl && (canSync || draft) && (
            <Suspense>
              <UpdateSystem
                systemId={system.id}
                draft={draft}
                lastSyncedAt={system.lastSyncedAt}
                thumbs={thumbs}
                latest={latest}
                comments={open.map((c) => ({ id: c.id, body: c.body, partName: c.partName, author: c.author, createdAt: c.createdAt }))}
                phone
              />
            </Suspense>
          )}
          <VersionTree tree={review.tree} comments={byId} onFocus={onFocus} refresh={canSync && me.onshape && review.treeDid ? { systemId: system.id, readAt: review.treeReadAt } : null} />
        </>
      )}
    />
  );
}
