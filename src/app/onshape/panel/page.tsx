import { asc, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { onshapeUrl, parseOnshapeUrl } from "@/lib/onshape/url";
import { LinkAssemblyForm } from "./LinkAssemblyForm";
import { PanelHome } from "./PanelHome";
import { panelPlace } from "./place";
import { PanelSignIn } from "./PanelSignIn";

// Linking runs the first Update BOM in the same request, then the new system's thumbnails in after().
export const maxDuration = 300;

// The right panel of an Onshape assembly (plan §4). Onshape opens it as
// /onshape/panel?server={$server}&documentId={$documentId}&workspaceOrVersion={$workspaceOrVersion}&workspaceOrVersionId={$workspaceOrVersionId}&elementId={$elementId}
// (the older ...&workspaceId={$workspaceId} still works). A linked assembly shows Update system,
// Comment, View BOM and View CAD (Harel, 2026-11-09); otherwise the member links it to a robot.
export default async function OnshapePanelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const place = panelPlace(await searchParams);
  return <div className="p-4 text-sm">{await panelBody(place.ref, place.query)}</div>;
}

async function panelBody(ref: ReturnType<typeof parseOnshapeUrl>, query: string) {
  if (!ref?.eid) return <p className="text-muted">Open this panel from an Onshape assembly.</p>;
  const member = await getMember();
  if (!member) return <PanelSignIn />;

  const linked = await db
    .select({ id: schema.systems.id, robotId: schema.systems.robotId, assemblyUrl: schema.systems.assemblyUrl })
    .from(schema.systems)
    .innerJoin(schema.robots, eq(schema.robots.id, schema.systems.robotId))
    .where(isNotNull(schema.systems.assemblyUrl))
    .orderBy(asc(schema.robots.archived), desc(schema.robots.year));
  const system = linked.find((s) => {
    const r = parseOnshapeUrl(s.assemblyUrl!);
    return r?.did === ref.did && r.eid === ref.eid;
  });
  if (system) return <PanelHome robotId={system.robotId} systemId={system.id} query={query} />;

  // A robot's main assembly: comments on the robot or one of its systems, its BOM and CAD.
  const mains = await db
    .select({ id: schema.robots.id, url: schema.robots.mainAssemblyUrl })
    .from(schema.robots)
    .where(isNotNull(schema.robots.mainAssemblyUrl))
    .orderBy(asc(schema.robots.archived), desc(schema.robots.year));
  const robot = mains.find((r) => {
    const m = parseOnshapeUrl(r.url!);
    return m?.did === ref.did && m.eid === ref.eid;
  });
  if (robot) return <PanelHome robotId={robot.id} systemId={null} query={query} />;

  // Linking keeps the assembly's workspace, which a version view doesn't give.
  if (ref.wvm !== "w") return <p className="text-muted">This assembly isn&apos;t linked yet. Open the document&apos;s workspace (not a version) to link it to a robot.</p>;

  const robots = await db
    .select({ id: schema.robots.id, name: schema.robots.name, layoutsDid: schema.robots.layoutsDocumentId })
    .from(schema.robots)
    .where(eq(schema.robots.archived, false))
    .orderBy(desc(schema.robots.year), asc(schema.robots.name));
  return (
    <LinkAssemblyForm
      assemblyUrl={onshapeUrl(ref)}
      documentUrl={onshapeUrl({ baseUrl: ref.baseUrl, did: ref.did, wvm: ref.wvm, wvmid: ref.wvmid })}
      robots={robots.map(({ id, name }) => ({ id, name }))}
      layoutsFor={robots.filter((r) => r.layoutsDid === ref.did).map((r) => r.name)}
      onshapeConnected={member.onshapeConnected}
      isAdmin={member.isAdmin}
    />
  );
}
