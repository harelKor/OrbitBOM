import { eq } from "drizzle-orm";
import Link from "next/link";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { isUuid } from "@/lib/uuid";
import { GeometryForm } from "../BasepartForms";
import { PanelSignIn } from "../PanelSignIn";
import { panelPlace } from "../place";

const { robots, systems } = schema;

// The Onshape panel's Geometry page (Harel, 2026-11-12): which sketches of the Basepart's Part
// Studio the 3D views draw. The list comes from Onshape after the page is up (GeometryPicker).
export default async function PanelGeometryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { query } = panelPlace(params);
  const member = await getMember();
  if (!member)
    return (
      <div className="p-4 text-sm">
        <PanelSignIn />
      </div>
    );
  const systemId = isUuid(params.systemId ?? "") ? params.systemId! : null;
  const robotId = !systemId && isUuid(params.robotId ?? "") ? params.robotId! : null;
  const [row] = systemId
    ? await db.select({ name: systems.name, studio: systems.basepartStudioUrl, sketches: systems.basepartSketches }).from(systems).where(eq(systems.id, systemId))
    : robotId
      ? await db.select({ name: robots.name, studio: robots.basepartStudioUrl, sketches: robots.basepartSketches }).from(robots).where(eq(robots.id, robotId))
      : [];
  const back = (
    <Link href={`/onshape/panel?${query}`} className="btn h-9 shrink-0 px-3 text-xs active:scale-[0.98]">
      ← Back
    </Link>
  );
  if (!row?.studio)
    return (
      <div className="space-y-4 p-4 text-sm">
        <div className="flex justify-end">{back}</div>
        <p className="text-muted">This Basepart has no Part Studio to take sketches from. Sync its Part Studio as the Basepart first.</p>
      </div>
    );
  if (robotId && !member.isAdmin)
    return (
      <div className="space-y-4 p-4 text-sm">
        <div className="flex justify-end">{back}</div>
        <p className="text-muted">Only an admin can change the robot&apos;s Geometry.</p>
      </div>
    );
  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted">Basepart · Geometry</p>
          <h1 className="truncate text-lg font-semibold text-fg">{row.name}</h1>
        </div>
        {back}
      </div>
      <GeometryForm target={systemId ? "system" : "robot"} id={(systemId ?? robotId)!} query={query} studioUrl={row.studio} initial={row.sketches} />
    </div>
  );
}
