import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { loadRobotReview } from "@/lib/data/cadReview";
import { modelPartsOfRobot } from "@/lib/data/parts";
import { robotModelsBuiltAt } from "@/lib/model/build";
import { isUuid } from "@/lib/uuid";
import { newestCadVersions } from "../insert-actions";
import { PanelSignIn } from "../PanelSignIn";
import { panelPlace } from "../place";
import { InsertFromRobot } from "./InsertFromRobot";

const { robots } = schema;

// Insert from robot (Harel, 2026-11-21, like FRCDesignLib): a light 3D view of a robot in the
// Onshape panel; parts picked there go into the open Part Studio or assembly at the version shown.
// Reads the database only; Insert itself is the only Onshape call.
export default async function PanelInsertPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { ref, query, kind } = panelPlace(params);
  const member = await getMember();
  if (!member)
    return (
      <div className="p-4 text-sm">
        <PanelSignIn />
      </div>
    );
  if (!ref?.eid) return <p className="p-4 text-sm text-muted">Open this panel from an Onshape Part Studio or assembly.</p>;
  const active = await db.select({ id: robots.id, name: robots.name }).from(robots).where(eq(robots.archived, false)).orderBy(desc(robots.year), asc(robots.name));
  const robotId = params.robotId && isUuid(params.robotId) ? params.robotId : active.length === 1 ? active[0].id : null;
  const back = `/onshape/panel?${query}`;
  if (!robotId)
    return (
      <div className="space-y-3 p-4 text-sm">
        <Link href={back} className="text-xs text-accent">
          ← Back
        </Link>
        <h1 className="text-xl font-bold text-fg">Insert from robot</h1>
        {active.map((r) => (
          <Link key={r.id} href={`/onshape/panel/insert?${query}&robotId=${r.id}`} className="btn flex min-h-11 w-full items-center active:scale-[0.98]">
            {r.name}
          </Link>
        ))}
      </div>
    );
  const [review, parts, builtAt, finalAt, baseAt] = await Promise.all([loadRobotReview(robotId), modelPartsOfRobot(robotId), robotModelsBuiltAt(robotId), newestCadVersions(robotId, "final"), newestCadVersions(robotId, "basepart")]);
  const robot = active.find((r) => r.id === robotId);
  return (
    <InsertFromRobot
      query={query}
      back={back}
      robotId={robotId}
      robotName={robot?.name ?? "Robot"}
      target={kind}
      readOnly={ref.wvm !== "w"}
      builtAt={builtAt}
      names={Object.fromEntries(parts.map((p) => [p.key, p.name]))}
      newest={{ final: finalAt, basepart: baseAt }}
      systems={review.systems.map((s) => ({ id: s.id, name: s.name, tree: s.tree, modelRef: s.modelRef, basepartTree: s.basepart?.tree ?? [], basepartRef: s.basepart?.modelRef ?? null }))}
    />
  );
}
