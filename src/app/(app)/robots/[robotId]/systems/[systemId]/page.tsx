import Link from "next/link";
import { notFound } from "next/navigation";
import { BomView } from "@/components/bom/BomView";
import { ManualPartButton } from "@/components/bom/ManualPartButton";
import { StatusBar } from "@/components/StatusBar";
import { requireMember } from "@/lib/auth";
import { listMemberNames, listSystemParts } from "@/lib/data/parts";
import { getSystem } from "@/lib/data/robots";
import { renameSystem } from "../../../actions";

export default async function SystemPage({
  params,
}: {
  params: Promise<{ robotId: string; systemId: string }>;
}) {
  await requireMember();
  const { robotId, systemId } = await params;
  const data = await getSystem(robotId, systemId);
  if (!data) notFound();
  const { system, robot, breakdown } = data;
  const [parts, memberNames] = await Promise.all([listSystemParts(system.id), listMemberNames()]);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/robots/${robot.id}`} className="text-sm text-slate-400 hover:text-slate-100">
          ← {robot.name}
        </Link>
        <form action={renameSystem.bind(null, robot.id, system.id)} className="mt-1 flex items-center gap-2">
          <input
            name="name"
            defaultValue={system.name}
            aria-label="System name"
            className="-ml-1 rounded-md border border-transparent bg-transparent px-1 text-3xl font-semibold hover:border-slate-700 focus:border-indigo-500 focus:outline-none"
          />
          <button className="btn">Save</button>
        </form>
        {system.assemblyUrl && (
          <a href={system.assemblyUrl} target="_blank" rel="noreferrer" className="text-sm text-slate-400 hover:text-slate-100">
            Open in Onshape ↗
          </a>
        )}
      </div>

      <section className="panel p-5">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="text-3xl font-semibold">{breakdown.percent}%</span>
          <span className="text-sm text-slate-400">
            {breakdown.done} / {breakdown.total} parts done
          </span>
        </div>
        <StatusBar breakdown={breakdown} />
      </section>

      <BomView parts={parts} memberNames={memberNames} toolbar={<ManualPartButton key="manual-part" systemId={system.id} />} />
      {parts.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
          {system.assemblyUrl
            ? "No parts yet. Update BOM from Onshape arrives with the Onshape connection; until then you can add manual parts."
            : "No parts yet. Add manual parts, or give this system an Onshape assembly."}
        </p>
      )}
    </div>
  );
}
