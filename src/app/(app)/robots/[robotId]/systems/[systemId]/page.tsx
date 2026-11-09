import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RecentActions } from "@/components/actions/RecentActions";
import { AutoRefresh } from "@/components/bom/AutoRefresh";
import { REFRESH } from "@/config/refresh";
import { BomView } from "@/components/bom/BomView";
import { ManualPartButton } from "@/components/bom/ManualPartButton";
import { partTitle } from "@/components/bom/types";
import { RobotViewer } from "@/components/dashboard/RobotViewer";
import { QaSection } from "@/components/qa/QaSection";
import { StatusBar } from "@/components/StatusBar";
import { UpdateSystem } from "@/components/versions/UpdateSystem";
import { VersionsWindow } from "@/components/versions/VersionsWindow";
import { STATUSES } from "@/config/statuses";
import { requireMember } from "@/lib/auth";
import { listRecentActions } from "@/lib/data/actions";
import { listComments } from "@/lib/data/cadReview";
import { listInventoryNames } from "@/lib/data/inventory";
import { listSystemMerges, listSystemParts } from "@/lib/data/parts";
import { getSystem } from "@/lib/data/robots";
import { fabStage } from "@/lib/fab";
import { robotModelBuiltAt } from "@/lib/model/build";
import { hasCapability } from "@/lib/mode";
import { isUuid } from "@/lib/uuid";
import { loadDraft } from "@/lib/versions/detect";
import { listVersions } from "@/lib/versions/history";
import { loadVersionTags } from "@/lib/versions/tags";

// Update System checks Onshape in a server action; thumbnails follow from /api/systems/[id]/thumbnails.
export const maxDuration = 60;

export default async function SystemPage({
  params,
}: {
  params: Promise<{ robotId: string; systemId: string }>;
}) {
  const { robotId, systemId } = await params;
  if (!isUuid(robotId) || !isUuid(systemId)) notFound();
  // Everything in one parallel round: the page waits for the slowest query, not their sum.
  const member = await requireMember();
  const [data, parts, merges, inventory, edit, modelBuiltAt, fabActions, systemActions, draft, versions, versionList, comments] = await Promise.all([
    getSystem(robotId, systemId),
    listSystemParts(systemId),
    listSystemMerges(systemId),
    listInventoryNames(),
    hasCapability("sync"),
    robotModelBuiltAt(robotId),
    listRecentActions({ robotId, memberId: member.id, systemId, fabOnly: true }, 30),
    listRecentActions({ robotId, memberId: member.id, systemId }, 30),
    loadDraft(systemId),
    loadVersionTags(systemId),
    listVersions(systemId),
    listComments(systemId),
  ]);
  if (!data) notFound();
  const { system, robot, breakdown } = data;
  // Open CAD Review comments: ticked off in the Commit window, counted on the chip.
  const openComments = comments.filter((c) => c.state === "open");
  const waiting = comments.filter((c) => c.state === "done").length;
  const thumbs = Object.fromEntries(parts.map((p) => [p.id, p.thumbUrl]));
  const statusColor = new Map<string, string>(STATUSES.map((s) => [s.name, s.color]));
  const viewerParts = parts.flatMap((p) =>
    p.modelKey
      ? [{ key: p.modelKey, color: statusColor.get(p.status) ?? "#cbd5e1", id: p.id, systemId: p.systemId, name: partTitle(p), fab: fabStage(p) !== null }]
      : [],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <Link href={`/robots/${robot.id}`} className="text-sm text-subtle hover:text-fg">
            {robot.name}
          </Link>
          {/* Versions and Update system sit on the name's line. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="min-w-0 truncate display text-3xl text-accent">{system.name}</h1>
            {system.assemblyUrl && (
              <div className="flex flex-wrap items-center gap-3">
                <Suspense>
                  <VersionsWindow systemId={system.id} list={versionList} thumbs={thumbs} />
                  <UpdateSystem systemId={system.id} draft={draft} lastSyncedAt={system.lastSyncedAt} thumbs={thumbs} latest={versions.latest && { id: versions.latest.id, label: versions.latest.label }} comments={openComments} />
                </Suspense>
                <ReviewChip href={`/robots/${robot.id}/systems/${system.id}/cad-review`} open={openComments.length} waiting={waiting} />
              </div>
            )}
          </div>
          {system.assemblyUrl && (
            <a href={system.assemblyUrl} target="_blank" rel="noreferrer" className="text-sm text-subtle hover:text-fg">
              Open in Onshape ↗
            </a>
          )}
        </div>
        <div className="w-full max-w-md min-w-60 flex-1">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">{breakdown.percent}%</span>
            <span className="text-sm text-subtle tabular-nums">
              {breakdown.done}/{breakdown.total} parts done
            </span>
          </div>
          <StatusBar breakdown={breakdown} />
        </div>
      </div>

      <QaSection parts={parts.filter((p) => p.status === "Ready for QA")} inventory={inventory} isAdmin={member.isAdmin} robotId={robot.id} />

      {system.assemblyUrl && REFRESH.openPages && <AutoRefresh systemId={system.id} />}

      {/* With a 3D view: on a big screen Recent actions is a column on its right that folds sideways,
          and the 3D view takes the rest (Harel, 2026-11-08). */}
      <div className={`grid gap-3 ${system.assemblyUrl ? "lg:h-[26rem] lg:grid-cols-[minmax(0,1fr)_auto]" : ""}`}>
        {(system.assemblyUrl || systemActions.length > 0) && (
          <div className="flex max-h-80 min-h-0 flex-col lg:order-last lg:max-h-none">
            <RecentActions actions={fabActions} systemActions={systemActions} max={30} variant="list" side={!!system.assemblyUrl} />
          </div>
        )}
        {system.assemblyUrl && (
          <div className="flex h-[26rem] min-w-0 flex-col">
            <RobotViewer
              robotId={robot.id}
              systemId={system.id}
              statuses={breakdown.statuses.filter((s) => s.count > 0)}
              parts={viewerParts}
              builtAt={modelBuiltAt}
              hasAssembly
              edit={edit}
            />
          </div>
        )}
      </div>

      <BomView parts={parts} inventory={inventory} isAdmin={member.isAdmin} merges={merges} mergeSystemId={system.id} robotId={robot.id} allowRelease versions={versions} stickyToolbar toolbar={<ManualPartButton key="manual-part" systemId={system.id} />} />
      {parts.length === 0 && (
        <p className="rounded-lg border border-dashed border-line-strong p-8 text-center text-sm text-muted">
          {system.assemblyUrl
            ? edit
              ? "No parts yet. Click Update System to pull this system\u2019s parts from Onshape."
              : "No parts yet. The CAD Team clicks Update System to pull this system\u2019s parts from Onshape."
            : "No parts yet. An admin adds manual parts in Edit mode, or gives this system an Onshape assembly."}
        </p>
      )}
    </div>
  );
}

// The system's CAD Review: its open comments and those waiting for a mentor, one tap away.
function ReviewChip({ href, open, waiting }: { href: string; open: number; waiting: number }) {
  return (
    <Link
      href={href}
      className="press inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-sm font-semibold text-fg-2 hover:border-accent/50 hover:text-fg active:scale-[0.98] pointer-coarse:min-h-9"
    >
      CAD
      {open > 0 && <span className="rounded-full bg-amber-500/15 px-1.5 text-xs text-amber-600 tabular-nums">{open} open</span>}
      {waiting > 0 && <span className="rounded-full bg-sky-500/15 px-1.5 text-xs text-sky-600 tabular-nums">{waiting} to approve</span>}
    </Link>
  );
}
