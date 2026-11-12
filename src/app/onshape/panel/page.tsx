import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { onshapeUrl, parseOnshapeUrl, type OnshapeRef } from "@/lib/onshape/url";
import { ReplaceBasepartForm, SyncBasepartForm } from "./BasepartForms";
import { LinkAssemblyForm } from "./LinkAssemblyForm";
import { PanelHome } from "./PanelHome";
import { panelPlace } from "./place";
import { PanelSignIn } from "./PanelSignIn";

// Linking runs the first Update BOM in the same request, then the new system's thumbnails in after().
export const maxDuration = 300;

const { robots, systems } = schema;

// The right panel of an Onshape assembly or Part Studio (plan §4). Onshape opens it as
// /onshape/panel?server={$server}&documentId={$documentId}&workspaceOrVersion={$workspaceOrVersion}&workspaceOrVersionId={$workspaceOrVersionId}&elementId={$elementId}
// (the older ...&workspaceId={$workspaceId} still works), with &kind=partstudio from the Part
// Studio extension. Linked, it shows Update system, Comment, View BOM and View CAD (Harel,
// 2026-11-09); a Basepart shows its own home (Harel, 2026-11-12). Otherwise (Harel, 2026-11-12):
//   - a Part Studio: Sync as system Basepart (admins: also Sync as robot Basepart);
//   - an assembly in the same document as a system's Basepart Part Studio: only Replace as system
//     Basepart; in the robot's Basepart document admins get Replace as robot Basepart, with the
//     robot's Final below it (the robot Final lives in that document too);
//   - any other assembly: Sync as system Final (admins: also Sync as robot Final), or Batch Layouts.
export default async function OnshapePanelPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const place = panelPlace(await searchParams);
  return <div className="p-4 text-sm">{await panelBody(place.ref, place.query, place.kind)}</div>;
}

const isAt = (url: string | null, ref: OnshapeRef) => {
  const r = url ? parseOnshapeUrl(url) : null;
  return r?.did === ref.did && r.eid === ref.eid;
};
const inDoc = (url: string | null, ref: OnshapeRef) => (url ? parseOnshapeUrl(url)?.did === ref.did : false);

async function panelBody(ref: ReturnType<typeof parseOnshapeUrl>, query: string, kind: "partstudio" | "assembly") {
  if (!ref?.eid) return <p className="text-muted">Open this panel from an Onshape assembly or Part Studio.</p>;
  const member = await getMember();
  if (!member) return <PanelSignIn />;

  const [systemRows, robotRows] = await Promise.all([
    db
      .select({
        id: systems.id,
        name: systems.name,
        robotId: systems.robotId,
        assemblyUrl: systems.assemblyUrl,
        basepartUrl: systems.basepartUrl,
        basepartKind: systems.basepartKind,
        basepartStudioUrl: systems.basepartStudioUrl,
        archived: robots.archived,
      })
      .from(systems)
      .innerJoin(robots, eq(robots.id, systems.robotId))
      .orderBy(asc(robots.archived), desc(robots.year), asc(systems.name)),
    db
      .select({
        id: robots.id,
        name: robots.name,
        archived: robots.archived,
        mainAssemblyUrl: robots.mainAssemblyUrl,
        basepartUrl: robots.basepartUrl,
        basepartKind: robots.basepartKind,
        basepartStudioUrl: robots.basepartStudioUrl,
        layoutsDid: robots.layoutsDocumentId,
      })
      .from(robots)
      .orderBy(asc(robots.archived), desc(robots.year), asc(robots.name)),
  ]);

  // Linked already: a system's or the robot's Final, or its Basepart (the Part Studio stays linked
  // after its assembly replaced it, for its Geometry and comments).
  const final = systemRows.find((s) => isAt(s.assemblyUrl, ref));
  if (final) return <PanelHome robotId={final.robotId} systemId={final.id} query={query} model="final" />;
  const base = systemRows.find((s) => isAt(s.basepartUrl, ref) || isAt(s.basepartStudioUrl, ref));
  if (base) return <PanelHome robotId={base.robotId} systemId={base.id} query={query} model="basepart" />;
  const main = robotRows.find((r) => isAt(r.mainAssemblyUrl, ref));
  if (main) return <PanelHome robotId={main.id} systemId={null} query={query} model="final" />;
  const robotBase = robotRows.find((r) => isAt(r.basepartUrl, ref) || isAt(r.basepartStudioUrl, ref));
  if (robotBase) return <PanelHome robotId={robotBase.id} systemId={null} query={query} model="basepart" />;

  const what = kind === "partstudio" ? "Part Studio" : "assembly";
  // Linking keeps the element's workspace, which a version view doesn't give.
  if (ref.wvm !== "w") return <p className="text-muted">This {what} isn&apos;t linked yet. Open the document&apos;s workspace (not a version) to link it to a robot.</p>;

  const active = robotRows.filter((r) => !r.archived);
  const activeIds = new Set(active.map((r) => r.id));
  const robotChoices = active.map(({ id, name }) => ({ id, name }));
  const url = onshapeUrl(ref);

  if (kind === "partstudio")
    return (
      <SyncBasepartForm
        studioUrl={url}
        query={query}
        robots={robotChoices}
        systems={systemRows.filter((s) => activeIds.has(s.robotId) && !s.basepartUrl).map(({ id, name, robotId }) => ({ id, name, robotId }))}
        isAdmin={member.isAdmin}
        onshapeConnected={member.onshapeConnected}
      />
    );

  const robotName = new Map(robotRows.map((r) => [r.id, r.name]));
  const replaceSystems = systemRows
    .filter((s) => activeIds.has(s.robotId) && s.basepartKind === "partstudio" && inDoc(s.basepartUrl, ref))
    .map((s) => ({ id: s.id, name: s.name, robotName: robotName.get(s.robotId) ?? "Robot" }));
  const replaceRobots = member.isAdmin ? active.filter((r) => r.basepartKind === "partstudio" && inDoc(r.basepartUrl, ref)).map(({ id, name }) => ({ id, name })) : [];
  if (replaceSystems.length) return <ReplaceBasepartForm assemblyUrl={url} query={query} systems={replaceSystems} robots={replaceRobots} />;

  const linkForm = (divided: boolean) => (
    <LinkAssemblyForm
      assemblyUrl={url}
      documentUrl={onshapeUrl({ baseUrl: ref.baseUrl, did: ref.did, wvm: ref.wvm, wvmid: ref.wvmid })}
      robots={robotChoices}
      systems={systemRows.filter((s) => activeIds.has(s.robotId) && !s.assemblyUrl).map(({ id, name, robotId }) => ({ id, name, robotId }))}
      layoutsFor={active.filter((r) => r.layoutsDid === ref.did).map((r) => r.name)}
      onshapeConnected={member.onshapeConnected}
      isAdmin={member.isAdmin}
      divided={divided}
    />
  );
  if (replaceRobots.length)
    return (
      <div className="space-y-6">
        <ReplaceBasepartForm assemblyUrl={url} query={query} systems={[]} robots={replaceRobots} />
        {linkForm(true)}
      </div>
    );
  return linkForm(false);
}
