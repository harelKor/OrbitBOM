import { and, asc, eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { listComments } from "@/lib/data/cadReview";
import { getMode } from "@/lib/mode";
import { partKey } from "@/lib/model/assembly";
import { canApprove, canTick } from "@/lib/reviews/comments";
import { isUuid } from "@/lib/uuid";
import { PanelSignIn } from "../PanelSignIn";
import { panelPlace } from "../place";
import { PanelComments } from "./PanelComments";

const { parts, robots, systems } = schema;

// The Onshape panel's comment page (Harel, 2026-11-09): only writing and answering comments, no
// 3D view, since the CAD is already open in Onshape next to it. A comment goes on the Onshape
// version open there (src/lib/reviews/panelVersion.ts), which the client asks for once loaded.
export default async function PanelCommentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { ref, query } = panelPlace(params);
  const member = await getMember();
  if (!member)
    return (
      <div className="p-4 text-sm">
        <PanelSignIn />
      </div>
    );

  const systemId = isUuid(params.systemId ?? "") ? params.systemId! : null;
  let robotId = isUuid(params.robotId ?? "") ? params.robotId! : null;
  let systemName: string | null = null;
  if (systemId) {
    const [s] = await db.select({ robotId: systems.robotId, name: systems.name }).from(systems).where(eq(systems.id, systemId));
    robotId = s?.robotId ?? null;
    systemName = s?.name ?? null;
  }
  const [robot] = robotId ? await db.select({ name: robots.name }).from(robots).where(eq(robots.id, robotId)) : [];
  if (!robotId || !robot) return <p className="p-4 text-sm text-muted">That system is gone. Reopen the panel.</p>;

  const [mode, comments, systemRows, partRows] = await Promise.all([
    getMode(),
    systemId ? listComments(systemId) : listComments({ robotId }),
    // On a robot's main assembly a comment goes on the robot or one of its linked systems.
    systemId ? Promise.resolve([]) : db.select({ id: systems.id, name: systems.name }).from(systems).where(and(eq(systems.robotId, robotId), isNotNull(systems.assemblyUrl))).orderBy(asc(systems.name)),
    db
      .select({ systemId: parts.systemId, did: parts.sourceDid, eid: parts.sourceEid, pid: parts.onshapePartId, name: parts.displayName, onshapeName: parts.onshapeName, number: parts.partNumber })
      .from(parts)
      .innerJoin(systems, eq(systems.id, parts.systemId))
      .where(and(systemId ? eq(parts.systemId, systemId) : eq(systems.robotId, robotId), isNotNull(parts.onshapePartId)))
      .orderBy(asc(parts.displayName), asc(parts.onshapeName)),
  ]);
  const partList = partRows.flatMap((p) => (p.did && p.eid && p.pid && p.systemId ? [{ key: partKey(p.did, p.eid, p.pid), name: p.name || p.onshapeName || p.number || "Unnamed part", systemId: p.systemId }] : []));

  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted">{robot.name}</p>
          <h1 className="truncate text-lg font-semibold text-fg">{systemName ?? "Whole robot"} · Comments</h1>
        </div>
        <Link href={`/onshape/panel?${query}`} className="btn h-9 shrink-0 px-3 text-xs active:scale-[0.98]">
          ← Back
        </Link>
      </div>
      <PanelComments
        robotId={robotId}
        systemId={systemId}
        systems={systemRows}
        parts={partList}
        comments={comments}
        place={{ did: ref?.did ?? null, wv: ref?.wvm === "v" ? "v" : ref ? "w" : null, wvId: ref?.wvmid ?? null }}
        me={{ id: member.id, isAdmin: member.isAdmin }}
        canTick={canTick(mode, member)}
        canApprove={canApprove(mode, member)}
        model={params.model === "basepart" ? "basepart" : "final"}
      />
    </div>
  );
}
