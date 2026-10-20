import Link from "next/link";
import { notFound } from "next/navigation";
import { BomView } from "@/components/bom/BomView";
import { partTitle } from "@/components/bom/types";
import { CompletionRing } from "@/components/dashboard/CompletionRing";
import { RobotViewer } from "@/components/dashboard/RobotViewer";
import { Icon } from "@/components/ui/Icon";
import { requireMember } from "@/lib/auth";
import { listInventoryNames, robotInventory } from "@/lib/data/inventory";
import { listRobotParts } from "@/lib/data/parts";
import { getRobot } from "@/lib/data/robots";
import { fabStage } from "@/lib/fab";
import { isEditMode } from "@/lib/mode";
import { processBreakdown } from "@/lib/stats";
import { NewSystemButton } from "./NewSystemButton";
import { RobotInventory } from "./RobotInventory";
import { RobotSettings } from "./RobotSettings";

// The robot dashboard: launch cards for To Fab and To Review, status and process completion,
// the 3D stage, and every part of the robot (searched and filtered from the top bar).
export default async function RobotPage({
  params,
  searchParams,
}: {
  params: Promise<{ robotId: string }>;
  searchParams: Promise<{ locate?: string }>;
}) {
  const member = await requireMember();
  const [{ robotId }, { locate }] = await Promise.all([params, searchParams]);
  const data = await getRobot(robotId);
  if (!data) notFound();
  const { robot, breakdown } = data;
  const [parts, inventoryNames, inventory, edit] = await Promise.all([
    listRobotParts(robot.id),
    listInventoryNames(),
    robotInventory(robot.id),
    isEditMode(),
  ]);

  const inProcess = parts.filter((p) => fabStage(p) === "inProcess").length;
  const ready = parts.filter((p) => fabStage(p) === "ready").length;
  const processes = processBreakdown(parts);
  const activeStatuses = breakdown.statuses.filter((s) => s.count > 0);
  const located = locate ? parts.find((p) => p.id === locate) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-3xl font-bold tracking-tight">{robot.name}</h1>
          <div className="text-sm text-slate-500 tabular-nums">
            {robot.year}
            {robot.code && `, robot ${robot.code}`}
            {robot.archived && ", archived"}
          </div>
        </div>
        {edit && (
          <>
            <NewSystemButton robotId={robot.id} />
            <RobotSettings robot={robot} isAdmin={member.isAdmin} />
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <LaunchCard
          href={`/robots/${robot.id}/fab`}
          icon="fab"
          title="To Fab"
          count={inProcess + ready}
          detail={`${inProcess} in process, ${ready} ready to fab`}
        />
        <LaunchCard href={`/robots/${robot.id}/review`} icon="review" title="To Review" count={0} detail="Parts set up automatically wait here" />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="panel space-y-5 p-4">
          <div className="flex items-center gap-5">
            <CompletionRing percent={breakdown.percent} done={breakdown.done} total={breakdown.total} />
            <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
              {activeStatuses.map((s) => (
                <li key={s.name} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1 truncate text-slate-300">{s.name}</span>
                  <span className="font-semibold tabular-nums">{s.count}</span>
                  <span className="w-10 text-right text-xs text-slate-500 tabular-nums">{s.percent}%</span>
                </li>
              ))}
              {activeStatuses.length === 0 && <li className="text-slate-500">No parts yet. Pick a system on the right and update its BOM.</li>}
            </ul>
          </div>
          {processes.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-semibold text-slate-400">By process</h2>
              <ul className="space-y-2">
                {processes.map((p) => (
                  <li key={p.id}>
                    <Link href={`/robots/${robot.id}/fab?machine=${p.id}`} className="group block">
                      <div className="mb-1 flex items-baseline justify-between text-xs">
                        <span className="text-slate-300 group-hover:text-white">{p.name}</span>
                        <span className="text-slate-500 tabular-nums">
                          {p.done}/{p.total}, {p.percent}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                        <div className="h-full rounded-full bg-gradient-to-r from-accent to-gold" style={{ width: `${p.percent}%` }} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <RobotViewer statuses={activeStatuses} locate={located ? { name: partTitle(located) } : null} />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All parts</h2>
        <BomView parts={parts} inventory={inventoryNames} isAdmin={member.isAdmin} showSystem allowBulkEdit={false} robotId={robot.id} />
      </section>

      <details className="group">
        <summary className="press flex cursor-pointer list-none items-center gap-2 text-sm text-slate-400 hover:text-white">
          <Icon name="chevron" className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
          Inventory used by this robot
        </summary>
        <div className="mt-3">
          <RobotInventory items={inventory} />
        </div>
      </details>
    </div>
  );
}

function LaunchCard({ href, icon, title, count, detail }: { href: string; icon: "fab" | "review"; title: string; count: number; detail: string }) {
  return (
    <Link href={href} className="card-interactive group flex items-center gap-4 p-5">
      <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-line-strong bg-raised text-accent-hover group-hover:border-accent/60">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-400">{title}</div>
        <div className="text-3xl font-bold tracking-tight tabular-nums">
          {count} <span className="text-base font-medium text-slate-400">{count === 1 ? "part" : "parts"}</span>
        </div>
        <div className="truncate text-xs text-slate-500">{detail}</div>
      </div>
      <Icon name="arrow" className="h-5 w-5 text-slate-500 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-white" />
    </Link>
  );
}
