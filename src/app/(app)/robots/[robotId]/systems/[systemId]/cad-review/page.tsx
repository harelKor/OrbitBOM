import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { partTitle } from "@/components/bom/types";
import { loadSystemReview } from "@/lib/data/cadReview";
import { listSystemParts } from "@/lib/data/parts";
import { getSystem } from "@/lib/data/robots";
import { getMode } from "@/lib/mode";
import { can } from "@/components/shell/mode";
import { robotModelBuiltAt } from "@/lib/model/build";
import { canTick } from "@/lib/reviews/comments";
import { isUuid } from "@/lib/uuid";
import { loadDraft } from "@/lib/versions/detect";
import { loadVersionTags } from "@/lib/versions/tags";
import { SystemReview } from "./SystemReview";

// A system's CAD Review (Harel, 2026-11-08): its 3D view, the version tree with the comments of
// each version, open comments and (for mentors) those waiting for approval, and Update system.
// Reads the database only; Update system and the tree's Refresh are the only Onshape calls.
export const maxDuration = 60;

export default async function SystemReviewPage({ params }: { params: Promise<{ robotId: string; systemId: string }> }) {
  const { robotId, systemId } = await params;
  if (!isUuid(robotId) || !isUuid(systemId)) notFound();
  const [member, mode] = await Promise.all([requireMember(), getMode()]);
  const [data, review, parts, builtAt, draft, tags] = await Promise.all([
    getSystem(robotId, systemId),
    loadSystemReview(systemId),
    listSystemParts(systemId),
    robotModelBuiltAt(robotId),
    loadDraft(systemId),
    loadVersionTags(systemId),
  ]);
  if (!data || !review) notFound();
  const { system, robot } = data;

  return (
    <SystemReview
      robotId={robot.id}
      robotName={robot.name}
      system={{ id: system.id, name: system.name, assemblyUrl: system.assemblyUrl, lastSyncedAt: system.lastSyncedAt }}
      review={review}
      parts={parts.flatMap((p) => (p.modelKey ? [{ id: p.id, key: p.modelKey, name: partTitle(p) }] : []))}
      thumbs={Object.fromEntries(parts.map((p) => [p.id, p.thumbUrl]))}
      builtAt={builtAt}
      draft={draft}
      latest={tags.latest && { id: tags.latest.id, label: tags.latest.label }}
      me={{ id: member.id, isAdmin: member.isAdmin, isMentor: member.isMentor, onshape: member.onshapeConnected }}
      canTick={canTick(mode, member)}
      canSync={can(mode, "sync")}
    />
  );
}
