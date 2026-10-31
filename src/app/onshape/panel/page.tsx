import { asc, desc, eq, isNotNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { onshapeUrl, parseOnshapeUrl } from "@/lib/onshape/url";
import { LinkAssemblyForm } from "./LinkAssemblyForm";
import { PanelSignIn } from "./PanelSignIn";

// Linking runs the first Update BOM in the same request, then the new system's thumbnails in after().
export const maxDuration = 300;

// The right panel of an Onshape assembly (plan §4). Onshape opens it as
// /onshape/panel?server={$server}&documentId={$documentId}&workspaceId={$workspaceId}&elementId={$elementId}
// A linked assembly goes straight to its system page, which checks it for changes to commit
// (?check=1); otherwise the member links it to a robot.
export default async function OnshapePanelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { server, documentId, workspaceId, elementId } = await searchParams;
  const host = server && /^https:\/\/[a-z0-9-]+\.onshape\.com\/?$/i.test(server) ? server.replace(/\/$/, "") : "https://cad.onshape.com";
  const ref = parseOnshapeUrl(`${host}/documents/${documentId}/w/${workspaceId}/e/${elementId}`);

  return <div className="p-4 text-sm">{await panelBody(ref)}</div>;
}

async function panelBody(ref: ReturnType<typeof parseOnshapeUrl>) {
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
  if (system) redirect(`/robots/${system.robotId}/systems/${system.id}?check=1`);

  // A robot's main assembly opens that robot's dashboard and its 3D view.
  const mains = await db
    .select({ id: schema.robots.id, url: schema.robots.mainAssemblyUrl })
    .from(schema.robots)
    .where(isNotNull(schema.robots.mainAssemblyUrl))
    .orderBy(asc(schema.robots.archived), desc(schema.robots.year));
  const robot = mains.find((r) => {
    const m = parseOnshapeUrl(r.url!);
    return m?.did === ref.did && m.eid === ref.eid;
  });
  if (robot) redirect(`/robots/${robot.id}`);

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
    />
  );
}
