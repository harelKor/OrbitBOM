import Link from "next/link";
import { notFound } from "next/navigation";
import { RecentActions } from "@/components/actions/RecentActions";
import { AutoRefresh } from "@/components/bom/AutoRefresh";
import { BomView } from "@/components/bom/BomView";
import { ManualPartButton } from "@/components/bom/ManualPartButton";
import { UpdateBomButton } from "@/components/bom/UpdateBomButton";
import { partTitle } from "@/components/bom/types";
import { RobotViewer } from "@/components/dashboard/RobotViewer";
import { QaSection } from "@/components/qa/QaSection";
import { StatusBar } from "@/components/StatusBar";
import { STATUSES } from "@/config/statuses";
import { requireMember } from "@/lib/auth";
import { listRecentActions } from "@/lib/data/actions";
import { listInventoryNames } from "@/lib/data/inventory";
import { listSystemMerges, listSystemParts } from "@/lib/data/parts";
import { getSystem } from "@/lib/data/robots";
import { fabStage } from "@/lib/fab";
import { robotModelBuiltAt } from "@/lib/model/build";
import { isEditMode } from "@/lib/mode";

// Update BOM pulls the BOM in this request; thumbnails follow from /api/systems/[id]/thumbnails.
export const maxDuration = 60;

export default async function SystemPage({
  params,
}: {
  params: Promise<{ robotId: string; systemId: string }>;
}) {
  const member = await requireMember();
  const { robotId, systemId } = await params;
  const data = await getSystem(robotId, systemId);
  if (!data) notFound();
  const { system, robot, breakdown } = data;
  const [parts, merges, inventory, edit, modelBuiltAt, fabActions] = await Promise.all([
    listSystemParts(system.id),
    listSystemMerges(system.id),
    listInventoryNames(),
    isEditMode(),
    robotModelBuiltAt(robot.id),
    listRecentActions({ robotId: robot.id, memberId: member.id, systemId: system.id, fabOnly: true }, 30),
  ]);
  const statusColor = new Map<string, string>(STATUSES.map((s) => [s.name, s.color]));
  const viewerParts = parts.flatMap((p) =>
    p.modelKey
      ? [{ key: p.modelKey, color: statusColor.get(p.status) ?? "#cbd5e1", id: p.id, systemId: p.systemId, name: partTitle(p), fab: fabStage(p) !== null, material: p.material, onshapeMaterial: p.geometry?.onshapeMaterial ?? null }]
      : [],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <Link href={`/robots/${robot.id}`} className="text-sm text-subtle hover:text-fg">
            {robot.name}
          </Link>
          <h1 className="min-w-0 truncate display text-3xl text-accent">{system.name}</h1>
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

      {system.assemblyUrl && (
        <>
          {edit && <UpdateBomButton systemId={system.id} lastSyncedAt={system.lastSyncedAt} />}
          <AutoRefresh systemId={system.id} />
        </>
      )}

      <div className={`grid gap-3 ${system.assemblyUrl ? "lg:h-[26rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" : ""}`}>
        {(system.assemblyUrl || fabActions.length > 0) && (
          <div className="flex max-h-80 min-h-0 flex-col lg:max-h-none">
            <RecentActions actions={fabActions} max={30} variant="list" />
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

      <BomView parts={parts} inventory={inventory} isAdmin={member.isAdmin} merges={merges} mergeSystemId={system.id} robotId={robot.id} toolbar={<ManualPartButton key="manual-part" systemId={system.id} />} />
      {parts.length === 0 && (
        <p className="rounded-lg border border-dashed border-line-strong p-8 text-center text-sm text-muted">
          {system.assemblyUrl
            ? edit
              ? "No parts yet. Click Update BOM from Onshape to pull this system\u2019s parts."
              : "No parts yet. Switch to Edit and click Update BOM from Onshape to pull this system\u2019s parts."
            : "No parts yet. Add manual parts in Edit mode, or give this system an Onshape assembly."}
        </p>
      )}
    </div>
  );
}
