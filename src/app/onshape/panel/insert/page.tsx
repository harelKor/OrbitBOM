import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { loadRobotReview } from "@/lib/data/cadReview";
import { modelPartsOfRobot } from "@/lib/data/parts";
import { robotModelsBuiltAt } from "@/lib/model/build";
import { insertedHere } from "@/lib/onshape/insert";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { imageUrl } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";
import { newestCadVersions } from "../insert-actions";
import { PanelSignIn } from "../PanelSignIn";
import { panelPlace } from "../place";
import { InsertedHere } from "./InsertedHere";
import { InsertFromRobot } from "./InsertFromRobot";
import { ShelfTab } from "./ShelfTab";

const { robots } = schema;

type Tab = "robot" | "shelf" | "here";
const TABS: [Tab, string][] = [
  ["robot", "From robot"],
  ["shelf", "From shelf"],
  ["here", "Inserted here"],
];

// Insert (Harel, 2026-11-21, like FRCDesignLib): parts of a robot's systems or the shelf's library
// parts go into the open Part Studio or assembly at a fixed version. "Inserted here" lists what
// went into this tab. Reads the database only; Insert and Update are the only Onshape calls.
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
  const tab: Tab = params.tab === "shelf" || params.tab === "here" ? params.tab : "robot";
  const robotParam = params.robotId && isUuid(params.robotId) ? params.robotId : null;
  const href = (t: Tab) => `/onshape/panel/insert?${query}${robotParam ? `&robotId=${robotParam}` : ""}${t === "robot" ? "" : `&tab=${t}`}`;
  return (
    <div className="flex min-h-dvh flex-col text-sm">
      <div className="flex items-center gap-1 border-b border-border px-3 pt-3">
        <Link href={`/onshape/panel?${query}`} className="mr-1 pb-2 text-xs text-accent">
          ←
        </Link>
        {TABS.map(([t, label]) => (
          <Link key={t} href={href(t)} className={`-mb-px border-b-2 px-2 pb-2 text-xs font-semibold ${t === tab ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`} aria-current={t === tab ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </div>
      {tab === "here" ? (
        <div className="p-3">
          <InsertedHere query={query} rows={await insertedHere(ref.did, ref.eid)} />
        </div>
      ) : tab === "shelf" ? (
        <ShelfTab query={query} readOnly={ref.wvm !== "w"} />
      ) : (
        await robotTab(query, kind, ref.wvm !== "w", robotParam)
      )}
    </div>
  );
}

async function robotTab(query: string, kind: "partstudio" | "assembly", readOnly: boolean, robotParam: string | null) {
  const active = await db.select({ id: robots.id, name: robots.name }).from(robots).where(eq(robots.archived, false)).orderBy(desc(robots.year), asc(robots.name));
  const robotId = robotParam ?? (active.length === 1 ? active[0].id : null);
  if (!robotId)
    return (
      <div className="space-y-2 p-3">
        <h1 className="text-lg font-bold text-fg">Which robot?</h1>
        {active.map((r) => (
          <Link key={r.id} href={`/onshape/panel/insert?${query}&robotId=${r.id}`} className="btn flex min-h-11 w-full items-center active:scale-[0.98]">
            {r.name}
          </Link>
        ))}
      </div>
    );
  const [review, parts, builtAt, finalAt, baseAt] = await Promise.all([loadRobotReview(robotId), modelPartsOfRobot(robotId), robotModelsBuiltAt(robotId), newestCadVersions(robotId, "final"), newestCadVersions(robotId, "basepart")]);
  const robot = active.find((r) => r.id === robotId);
  // The picked parts' pictures in the list below the view (signed links, never cached).
  const ids = [...new Set(parts.map((p) => p.id))];
  const revs = ids.length ? await db.select({ id: schema.parts.id, rev: schema.parts.thumbnailRev }).from(schema.parts).where(and(inArray(schema.parts.id, ids), isNotNull(schema.parts.thumbnailRev))) : [];
  const thumbs = new Map(await Promise.all(revs.map(async (r) => [r.id, await imageUrl(thumbKey(r.id, r.rev!))] as const)));
  return (
    <InsertFromRobot
      query={query}
      robotId={robotId}
      robotName={robot?.name ?? "Robot"}
      target={kind}
      readOnly={readOnly}
      builtAt={builtAt}
      info={Object.fromEntries(parts.map((p) => [p.key, { name: p.name, thumb: thumbs.get(p.id) ?? null }]))}
      newest={{ final: finalAt, basepart: baseAt }}
      systems={review.systems.map((s) => ({ id: s.id, name: s.name, tree: s.tree, modelRef: s.modelRef, basepartTree: s.basepart?.tree ?? [], basepartRef: s.basepart?.modelRef ?? null }))}
    />
  );
}
