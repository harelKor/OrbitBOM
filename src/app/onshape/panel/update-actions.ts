"use server";

import { isActive } from "@/lib/reviews/status";
import { and, inArray, isNotNull } from "drizzle-orm";
import { checkForChanges } from "@/app/(app)/versions-actions";
import { db, schema } from "@/db";
import { listComments } from "@/lib/data/cadReview";
import { DENIED, hasCapability } from "@/lib/mode";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { imageUrl } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";
import type { CommitComment } from "@/components/versions/CommitWindow";
import type { Draft } from "@/lib/versions/detect";

export type PanelCheck = { error?: string; draft?: Draft | null; thumbs?: Record<string, string | null>; comments?: CommitComment[] };

// The Onshape panel's Update system (Harel, 2026-11-11): checks the assembly where the panel is,
// and returns what the Commit window needs (the changed parts' thumbnails, the open comments) so
// it opens right there, without going to the system page.
export async function panelCheckSystem(systemId: string): Promise<PanelCheck> {
  if (!isUuid(systemId)) return { error: "Unknown system." };
  if (!(await hasCapability("sync"))) return { error: DENIED.sync };
  const r = await checkForChanges(systemId, true);
  if (r.error || !r.draft) return { error: r.error, draft: r.draft ?? null };
  const ids = [...new Set(r.draft.changes.flatMap((c) => (c.partId ? [c.partId] : [])))];
  const [rows, comments] = await Promise.all([
    ids.length
      ? db
          .select({ id: schema.parts.id, rev: schema.parts.thumbnailRev })
          .from(schema.parts)
          .where(and(inArray(schema.parts.id, ids), isNotNull(schema.parts.thumbnailRev)))
      : [],
    listComments(systemId),
  ]);
  const thumbs = Object.fromEntries(await Promise.all(rows.map(async (p) => [p.id, await imageUrl(thumbKey(p.id, p.rev!))] as const)));
  return {
    draft: r.draft,
    thumbs,
    comments: comments.filter((c) => isActive(c.state)).map((c) => ({ id: c.id, body: c.body, partName: c.partName, author: c.author, createdAt: c.createdAt })),
  };
}

