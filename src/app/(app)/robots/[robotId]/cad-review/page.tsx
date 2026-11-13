import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { can } from "@/components/shell/mode";
import { loadRobotReview } from "@/lib/data/cadReview";
import { listSystemParts, modelPartsOfRobot } from "@/lib/data/parts";
import { basepartLinked, getSystem } from "@/lib/data/robots";
import { listShellRobots } from "@/lib/data/shell";
import { getMode } from "@/lib/mode";
import { robotModelsBuiltAt } from "@/lib/model/build";
import { canApprove, canTick } from "@/lib/reviews/comments";
import { isUuid } from "@/lib/uuid";
import { loadDraft } from "@/lib/versions/detect";
import { loadVersionTags } from "@/lib/versions/tags";
import { CadReview, type IsolatedExtras } from "./CadReview";

// CAD (Harel, 2026-11-10): the whole robot's review screen is CAD's main page. Its left panel has
// a section per system with its picture and Isolate, which scopes the page to that system the way
// its own page did (?system=<id>; the old system pages redirect here). Open comments sit top right,
// a section per system. Reads the database only; Update system and the tree's Refresh are the only
// Onshape calls.
export default async function CadPage({ params, searchParams }: { params: Promise<{ robotId: string }>; searchParams: Promise<{ system?: string | string[]; model?: string | string[] }> }) {
  const [{ robotId }, sp] = await Promise.all([params, searchParams]);
  if (!isUuid(robotId)) notFound();
  const systemId = typeof sp.system === "string" && isUuid(sp.system) ? sp.system : null;
  const [member, mode] = await Promise.all([requireMember(), getMode()]);
  const [robots, review, parts, builtAt, extras, hasBasepart] = await Promise.all([
    listShellRobots(),
    loadRobotReview(robotId),
    modelPartsOfRobot(robotId),
    robotModelsBuiltAt(robotId),
    systemId ? isolatedExtras(robotId, systemId) : null,
    basepartLinked(robotId),
  ]);
  const robot = robots.find((r) => r.id === robotId);
  if (!robot) notFound();
  const thumbs = Object.fromEntries(robot.systems.map((s) => [s.id, s.thumbUrl]));
  return (
    <CadReview
      robotId={robotId}
      robotName={robot.name}
      review={review}
      parts={parts}
      thumbs={thumbs}
      builtAt={builtAt}
      hasBasepart={hasBasepart}
      initialModel={sp.model === "basepart" ? "basepart" : undefined}
      isolatedId={review.systems.some((s) => s.id === systemId) ? systemId : null}
      extras={extras}
      me={{ id: member.id, isAdmin: member.isAdmin, isMentor: member.isMentor, onshape: member.onshapeConnected }}
      canTick={canTick(mode, member)}
      canApprove={canApprove(mode, member)}
      canSync={can(mode, "sync")}
      canCheck={can(mode, "check")}
      canManage={can(mode, "manage")}
    />
  );
}

// What only an isolated system's panel shows: Update system's draft, the newest version tag and
// the parts' pictures for its Commit window.
async function isolatedExtras(robotId: string, systemId: string): Promise<IsolatedExtras | null> {
  const [data, draft, tags, parts] = await Promise.all([getSystem(robotId, systemId), loadDraft(systemId), loadVersionTags(systemId), listSystemParts(systemId)]);
  if (!data) return null;
  const { system } = data;
  return {
    systemId,
    assemblyUrl: system.assemblyUrl,
    lastSyncedAt: system.lastSyncedAt,
    draft,
    latest: tags.latest && { id: tags.latest.id, label: tags.latest.label },
    partThumbs: Object.fromEntries(parts.map((p) => [p.id, p.thumbUrl])),
  };
}
