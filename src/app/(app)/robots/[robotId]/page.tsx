import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { RecentActions } from "@/components/actions/RecentActions";
import { BomView } from "@/components/bom/BomView";
import { partTitle } from "@/components/bom/types";
import { CompletionRing } from "@/components/dashboard/CompletionRing";
import { RobotViewer } from "@/components/dashboard/RobotViewer";
import { QaBox } from "@/components/qa/QaBox";
import { SyncBox } from "@/components/versions/SyncBox";
import { StorageBox } from "@/components/storage/StorageBox";
import { Icon } from "@/components/ui/Icon";
import { requireMember } from "@/lib/auth";
import { listRecentActions } from "@/lib/data/actions";
import { listInventoryNames, robotInventory } from "@/lib/data/inventory";
import { listRobotParts } from "@/lib/data/parts";
import { STATUSES } from "@/config/statuses";
import { robotModelBuiltAt } from "@/lib/model/build";
import { getRobot } from "@/lib/data/robots";
import { fabStage } from "@/lib/fab";
import { isEditMode } from "@/lib/mode";
import { isUuid } from "@/lib/uuid";
import { listRobotReviews } from "@/lib/review/review";
import { processBreakdown } from "@/lib/stats";
import { listSystemSync } from "@/lib/versions/sync";
import { storageTotal } from "@/lib/storage/usage";

// The robot dashboard: launch cards for To Fab and To Review, status and process completion,
// the 3D stage, a compact Inventory box above Recent actions, and every part of the robot
// (searched and filtered from the top bar).
export default async function RobotPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  // Everything in one parallel round: the page waits for the slowest query, not their sum.
  const member = await requireMember();
  const [data, parts, inventoryNames, inventory, edit, modelBuiltAt, reviews, actions, sync, stored] = await Promise.all([
    getRobot(robotId),
    listRobotParts(robotId),
    listInventoryNames(),
    robotInventory(robotId),
    isEditMode(),
    robotModelBuiltAt(robotId),
    listRobotReviews(robotId),
    listRecentActions({ robotId, memberId: member.id }),
    listSystemSync(),
    storageTotal(),
  ]);
  if (!data) notFound();
  const { robot, breakdown } = data;
  const aiReviews = reviews.filter((r) => r.source === "ai").length;
  const counted = inventory.filter((i) => !i.sheet);
  const shortItems = counted.filter((i) => i.covered < i.needed).length;
  const neededUnits = counted.reduce((n, i) => n + i.needed, 0);
  const coveredUnits = counted.reduce((n, i) => n + i.covered, 0);

  const inProcess = parts.filter((p) => fabStage(p) === "inProcess").length;
  const ready = parts.filter((p) => fabStage(p) === "ready").length;
  const processes = processBreakdown(parts);
  const qaCount = new Map<string, number>();
  for (const p of parts) if (p.status === "Ready for QA") qaCount.set(p.systemId, (qaCount.get(p.systemId) ?? 0) + 1);
  const qaSystems = data.systems.flatMap((s) => (qaCount.has(s.id) ? [{ id: s.id, name: s.name, count: qaCount.get(s.id)! }] : []));
  const syncSystems = data.systems.flatMap((s) => (s.assemblyUrl ? [{ id: s.id, name: s.name, ...(sync.get(s.id) ?? { outdated: null, waiting: 0 }) }] : []));
  const activeStatuses = breakdown.statuses.filter((s) => s.count > 0);
  // BOM parts by their key in the 3D model, with their status colour.
  const statusColor = new Map<string, string>(STATUSES.map((s) => [s.name, s.color]));
  const viewerParts = parts.flatMap((p) =>
    p.modelKey
      ? [{ key: p.modelKey, color: statusColor.get(p.status) ?? "#cbd5e1", id: p.id, systemId: p.systemId, name: partTitle(p), fab: fabStage(p) !== null, material: p.material, onshapeMaterial: p.geometry?.onshapeMaterial ?? null }]
      : [],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate display text-3xl text-accent">{robot.name}</h1>
          <div className="text-sm text-subtle tabular-nums">
            {robot.year}
            {robot.code && `, robot ${robot.code}`}
            {robot.archived && ", archived"}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <LaunchCard
          href={`/robots/${robot.id}/fab`}
          icon="fab"
          title="To Fab"
          count={inProcess + ready}
          detail={`${inProcess} in process, ${ready} released`}
        />
        <LaunchCard
          href={`/robots/${robot.id}/review`}
          icon="review"
          title="To Review"
          count={reviews.length}
          detail={reviews.length ? `${aiReviews} set up by Claude, ${reviews.length - aiReviews} by Suggest setup` : "Parts set up automatically wait here"}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,2fr)_minmax(0,5fr)]">
        <section className="panel space-y-5 p-4">
          <div className="flex items-center gap-5">
            <CompletionRing percent={breakdown.percent} done={breakdown.done} total={breakdown.total} />
            <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
              {activeStatuses.map((s) => (
                <li key={s.name} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1 truncate text-fg-2">{s.name}</span>
                  <span className="font-semibold tabular-nums">{s.count}</span>
                  <span className="w-10 text-right text-xs text-subtle tabular-nums">{s.percent}%</span>
                </li>
              ))}
              {activeStatuses.length === 0 && <li className="text-subtle">No parts yet. Pick a system on the right and update its BOM.</li>}
            </ul>
          </div>
          {processes.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-semibold text-muted">By process</h2>
              <ul className="space-y-2">
                {processes.map((p) => (
                  <li key={p.id}>
                    <Link href={`/robots/${robot.id}/fab?machine=${p.id}`} className="group block">
                      <div className="mb-1 flex items-baseline justify-between text-xs">
                        <span className="text-fg-2 group-hover:text-fg">{p.name}</span>
                        <span className="text-subtle tabular-nums">
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
        <div className="grid grid-rows-2 gap-3">
          <QaBox robotId={robot.id} systems={qaSystems} />
          <SyncBox robotId={robot.id} systems={syncSystems} />
        </div>
        <RobotViewer
          robotId={robot.id}
          statuses={activeStatuses}
          parts={viewerParts}
          builtAt={modelBuiltAt}
          hasAssembly={!!robot.mainAssemblyUrl || data.systems.some((s) => s.assemblyUrl)}
          edit={edit}
        />
      </div>

      <Suspense>
        <StorageBox total={stored} />
      </Suspense>

      <Link href={`/robots/${robot.id}/inventory`} className="card-interactive group flex items-center gap-3 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-raised text-accent-hover group-hover:border-accent/60">
          <Icon name="box" className="h-5 w-5" />
        </span>
        <span className="font-medium text-fg-2">Inventory</span>
        <span className="font-mono font-semibold text-accent tabular-nums">{shortItems}</span>
        <span className="text-sm text-muted">{shortItems === 1 ? "item short" : "items short"}</span>
        <span className="min-w-0 flex-1 truncate text-right text-sm text-subtle">
          {inventory.length ? `${coveredUnits}/${neededUnits} units covered by the shelf` : "No parts linked to inventory yet"}
        </span>
        <Icon name="arrow" className="h-5 w-5 shrink-0 text-subtle transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg" />
      </Link>

      <RecentActions actions={actions} max={8} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All parts</h2>
        <BomView parts={parts} inventory={inventoryNames} isAdmin={member.isAdmin} showSystem allowBulkEdit={false} robotId={robot.id} groupBySystem />
      </section>

    </div>
  );
}

function LaunchCard({ href, icon, title, count, detail }: { href: string; icon: "fab" | "review"; title: string; count: number; detail: string }) {
  return (
    <Link href={href} className="card-interactive group flex items-center gap-6 p-8">
      <span className="flex h-20 w-20 items-center justify-center rounded-xl border border-line-strong bg-raised text-accent-hover group-hover:border-accent/60">
        <Icon name={icon} className="h-9 w-9" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-lg font-medium text-muted">{title}</div>
        <div className="display text-6xl text-accent tabular-nums">
          {count} <span className="text-2xl font-medium text-muted">{count === 1 ? "part" : "parts"}</span>
        </div>
        <div className="truncate text-sm text-subtle">{detail}</div>
      </div>
      <Icon name="arrow" className="h-8 w-8 text-subtle transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg" />
    </Link>
  );
}
