import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/bom/AutoRefresh";
import { BomView } from "@/components/bom/BomView";
import { ManualPartButton } from "@/components/bom/ManualPartButton";
import { UpdateBomButton } from "@/components/bom/UpdateBomButton";
import { StatusBar } from "@/components/StatusBar";
import { requireMember } from "@/lib/auth";
import { listInventoryNames } from "@/lib/data/inventory";
import { listSystemMerges, listSystemParts } from "@/lib/data/parts";
import { getSystem } from "@/lib/data/robots";
import { isEditMode } from "@/lib/mode";
import { renameSystem } from "../../../actions";

// Update BOM fetches the BOM and new thumbnails in one request.
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
  const [parts, merges, inventory, edit] = await Promise.all([
    listSystemParts(system.id),
    listSystemMerges(system.id),
    listInventoryNames(),
    isEditMode(),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <Link href={`/robots/${robot.id}`} className="text-sm text-slate-500 hover:text-white">
            {robot.name}
          </Link>
          {edit ? (
            <form action={renameSystem.bind(null, robot.id, system.id)} className="flex items-center gap-2">
              <input
                name="name"
                defaultValue={system.name}
                aria-label="System name"
                className="-ml-1 min-w-0 rounded-md border border-transparent bg-transparent px-1 text-3xl font-bold tracking-tight hover:border-line-strong focus:border-accent focus:outline-none"
              />
              <button className="btn">Save</button>
            </form>
          ) : (
            <h1 className="truncate text-3xl font-bold tracking-tight">{system.name}</h1>
          )}
          {system.assemblyUrl && (
            <a href={system.assemblyUrl} target="_blank" rel="noreferrer" className="text-sm text-slate-500 hover:text-white">
              Open in Onshape ↗
            </a>
          )}
        </div>
        <div className="w-full max-w-md min-w-60 flex-1">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">{breakdown.percent}%</span>
            <span className="text-sm text-slate-500 tabular-nums">
              {breakdown.done}/{breakdown.total} parts done
            </span>
          </div>
          <StatusBar breakdown={breakdown} />
        </div>
      </div>

      {system.assemblyUrl && (
        <>
          {edit && <UpdateBomButton systemId={system.id} lastSyncedAt={system.lastSyncedAt} />}
          <AutoRefresh systemId={system.id} />
        </>
      )}

      <BomView parts={parts} inventory={inventory} isAdmin={member.isAdmin} merges={merges} mergeSystemId={system.id} robotId={robot.id} toolbar={<ManualPartButton key="manual-part" systemId={system.id} />} />
      {parts.length === 0 && (
        <p className="rounded-lg border border-dashed border-line-strong p-8 text-center text-sm text-slate-400">
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
