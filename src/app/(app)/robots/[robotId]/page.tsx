import { areaOfMachine } from "@/config/machines";
import { ArrivalMark } from "@/components/shell/Arrivals";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { RecentActions } from "@/components/actions/RecentActions";
import { BomView } from "@/components/bom/BomView";
import { partTitle } from "@/components/bom/types";
import { CompletionRing } from "@/components/dashboard/CompletionRing";
import { RobotViewer } from "@/components/dashboard/RobotViewer";
import { StatusPanel } from "@/components/dashboard/StatusPanel";
import { QaBox } from "@/components/qa/QaBox";
import { PostProcessBox } from "@/components/fab/PostProcessBox";
import { StorageBox } from "@/components/storage/StorageBox";
import { Icon } from "@/components/ui/Icon";
import { requireMember } from "@/lib/auth";
import { listRecentActions } from "@/lib/data/actions";
import { listRobotGroups } from "@/lib/data/groups";
import { listInventoryNames, robotInventory } from "@/lib/data/inventory";
import { listRobotParts } from "@/lib/data/parts";
import { DONE_STATUSES, STATUSES } from "@/config/statuses";
import { robotModelBuiltAt } from "@/lib/model/build";
import { getRobot } from "@/lib/data/robots";
import { AREA_READY, areaQueue, fabStage } from "@/lib/fab";
import { can } from "@/components/shell/mode";
import { getMode } from "@/lib/mode";
import { isUuid } from "@/lib/uuid";
import { processBreakdown } from "@/lib/stats";
import { storageTotal } from "@/lib/storage/usage";

// The robot dashboard: launch cards for Shop Fab, Factory Fab and 3D Printing, status and process
// completion, Ready for QA and Post Process, the 3D stage, a compact Inventory box above Recent
// actions, and every part of the robot (searched and filtered from the top bar). One layout for
// every team; a box glows when it holds work for the member's team (Harel, 2026-11-07).
export default async function RobotPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  // Everything in one parallel round: the page waits for the slowest query, not their sum.
  // The effective mode, so an admin previewing Build or CAD sees that team's glows.
  const [member, mode] = await Promise.all([requireMember(), getMode()]);
  const build = mode === "build";
  const cad = mode === "cad";
  // Update 3D model is an Onshape sync: CAD Team and Edit.
  const edit = can(mode, "sync");
  const [data, parts, inventoryNames, inventory, modelBuiltAt, actions, stored, groups] = await Promise.all([
    getRobot(robotId),
    listRobotParts(robotId),
    listInventoryNames(),
    robotInventory(robotId),
    robotModelBuiltAt(robotId),
    listRecentActions({ robotId, memberId: member.id }),
    storageTotal(),
    listRobotGroups(robotId),
  ]);
  if (!data) notFound();
  const { robot, breakdown } = data;
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
  const qaTotal = qaSystems.reduce((n, s) => n + s.count, 0);
  const postParts = parts.filter((p) => p.status === "Post Processing");
  // Factory Fab's and 3D Printing's queues, counted the way their pages and the side panel count them.
  const area = (a: "factory" | "print") => {
    const queued = parts.filter((p) => areaQueue(p, a));
    return { count: queued.length, released: queued.filter((p) => AREA_READY[a].includes(p.status)).length };
  };
  const factory = area("factory");
  const print = area("print");
  // The member's Shop Fab batches with a part not made yet (below Ready for QA): Shop Fab glows
  // and says "You have X" (Harel, 2026-11-07).
  const myBatches = groups.filter((g) => {
    if (g.madeBy !== member.name || areaOfMachine(g.machine)) return false;
    const members = parts.filter((p) => p.groups.some((x) => x.id === g.id));
    return members.some((p) => !(DONE_STATUSES as string[]).includes(p.status));
  }).length;
  const activeStatuses = breakdown.statuses.filter((s) => s.count > 0);
  // BOM parts by their key in the 3D model, with their status colour.
  const statusColor = new Map<string, string>(STATUSES.map((s) => [s.name, s.color]));
  const viewerParts = parts.flatMap((p) =>
    p.modelKey
      ? [{ key: p.modelKey, color: statusColor.get(p.status) ?? "#cbd5e1", id: p.id, systemId: p.systemId, name: partTitle(p), fab: fabStage(p) !== null }]
      : [],
  );

  // The status breakdown: in the row beside QA on a bigger screen; on a phone a folded section
  // under Inventory, closed at first (Harel, 2026-11-07).
  const statusBody = (
    <>
      {/* A narrow box puts the ring above the list, so the status names aren't cut. */}
      <div className="flex flex-col items-center gap-5 @min-[22rem]:flex-row">
        <CompletionRing percent={breakdown.percent} done={breakdown.done} total={breakdown.total} />
        <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
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
                <Link href={processHref(robot.id, p.id)} className="group block">
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
    </>
  );

  // Sized by the room the page has (container queries on this div), not the screen: the side
  // panels open or closed change it a lot on the same PC (Harel, 2026-11-07).
  return (
    <div className="@container/dash space-y-5">
      {/* No name and year on top: the robot is picked in the side panel (Harel, 2026-11-07). */}
      <h1 className="sr-only">{robot.name}</h1>

      {/* With room for it, the launch boxes and the row below fill the screen so the Inventory box's
          bottom sits a little above the screen's bottom, whatever the screen's height (8rem: main's
          top padding, the gap, the Inventory box and that offset; never under 36rem, so a short
          screen scrolls instead of crushing them) (Harel, 2026-11-07). */}
      <div className="space-y-5 @5xl:flex @5xl:h-[max(36rem,calc(100dvh-var(--topbar-h,2.75rem)-8rem))] @5xl:flex-col @5xl:gap-3 @5xl:space-y-0">
      <div className="grid gap-3 @5xl:grid-cols-2">
        {/* Glows while Shop Fab has parts this member hasn't seen (src/lib/seen.ts), or batches of theirs to make. */}
        <ArrivalMark page={`fab:${robot.id}`}>
          <LaunchCard
            href={myBatches ? `/robots/${robot.id}/fab?mine=1` : `/robots/${robot.id}/fab`}
            icon="fab"
            title="Shop Fab"
            count={inProcess + ready}
            detail={`${inProcess} in process, ${ready} released`}
            tag={myBatches ? `You have ${myBatches}` : undefined}
            glow={myBatches > 0}
          />
        </ArrivalMark>
        {/* 3D Printing next to Shop Fab takes two thirds, Factory Fab on the right a third (Harel, 2026-11-07). */}
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
          <ArrivalMark prefix={`print:${robot.id}:`}>
            <AreaCard href={`/robots/${robot.id}/printing`} icon="printer" title="3D Printing" count={print.count} released={print.released} glow={cad && print.count > 0} />
          </ArrivalMark>
          <ArrivalMark prefix={`factory:${robot.id}:`}>
            <AreaCard href={`/robots/${robot.id}/factory`} icon="factory" title="Factory Fab" count={factory.count} released={factory.released} />
          </ArrivalMark>
        </div>
      </div>

      {/* On a PC the 3D view is the widest column and keeps its shape, so it sets the row's height (Harel, 2026-11-07). */}
      {/* The status box and the QA column size themselves (by the page's width); the 3D view takes the rest, more when the status box is folded. */}
      {/* Side by side from a narrower page than the launch boxes, so with both side columns open the
          3D view is still the main thing, as with them closed (Harel, 2026-11-12). */}
      <div className="grid gap-3 @3xl:grid-cols-[auto_auto_minmax(0,1fr)] @5xl:min-h-0 @5xl:flex-1">
        <StatusPanel percent={breakdown.percent} done={breakdown.done} total={breakdown.total}>{statusBody}</StatusPanel>
        <div className="grid grid-cols-2 gap-3 @3xl:w-[max(8rem,13.3cqw)] @3xl:grid-cols-1 @3xl:grid-rows-2 @5xl:min-h-0">
          <QaBox robotId={robot.id} systems={qaSystems} parts={parts.filter((p) => p.status === "Ready for QA")} inventory={inventoryNames} isAdmin={member.isAdmin} glow={cad && qaTotal > 0} />
          <PostProcessBox robotId={robot.id} parts={postParts} inventory={inventoryNames} isAdmin={member.isAdmin} glow={build && postParts.length > 0} />
        </div>
        <div className="flex min-w-0 flex-col @5xl:min-h-0">
          <RobotViewer
            robotId={robot.id}
            statuses={activeStatuses}
            parts={viewerParts}
            builtAt={modelBuiltAt}
            hasAssembly={!!robot.mainAssemblyUrl || data.systems.some((s) => s.assemblyUrl)}
            edit={edit}
          />
        </div>
      </div>
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

      <details className="@container group/status panel md:hidden">
        <summary className="press flex cursor-pointer list-none items-center gap-3 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
          <Icon name="chevron" className="h-5 w-5 shrink-0 text-subtle transition-transform group-open/status:rotate-90" />
          <span className="flex-1 font-medium text-fg-2">Status</span>
          <span className="text-sm text-subtle tabular-nums">
            {breakdown.percent}%, {breakdown.done}/{breakdown.total} done
          </span>
        </summary>
        <div className="space-y-5 px-4 pb-4">{statusBody}</div>
      </details>

      <RecentActions actions={actions} max={8} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All parts</h2>
        <BomView parts={parts} inventory={inventoryNames} isAdmin={member.isAdmin} showSystem allowBulkEdit={false} robotId={robot.id} groupBySystem />
      </section>

    </div>
  );
}

function LaunchCard({ href, icon, title, count, detail, tag, glow }: { href: string; icon: "fab"; title: string; count: number; detail: string; tag?: string; glow?: boolean }) {
  return (
    <Link href={href} data-arrival={glow ? "" : undefined} className="@container card-interactive group flex items-center gap-6 p-6 active:scale-[0.98] sm:p-8">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-raised text-accent-hover group-hover:border-accent/60 sm:h-20 sm:w-20">
        <Icon name={icon} className="h-9 w-9" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-lg font-medium text-muted">{title}</span>
          {tag && <span className="rounded-full border border-amber-400/60 bg-amber-400/15 px-2.5 py-0.5 text-xs font-semibold text-amber-500 tabular-nums @min-[34rem]:hidden">{tag}</span>}
        </div>
        <div className="display text-6xl text-accent tabular-nums">
          {count} <span className="text-2xl font-medium text-muted">{count === 1 ? "part" : "parts"}</span>
        </div>
        <div className="truncate text-sm text-subtle">{detail}</div>
      </div>
      {/* A wide card's tag fills its empty right side, bigger the more room there is (Harel, 2026-11-07). */}
      {tag && (
        <span className="hidden shrink-0 rounded-2xl border-2 border-amber-400/70 bg-amber-400/15 px-4 py-2 text-xl font-bold whitespace-nowrap text-amber-500 tabular-nums @min-[34rem]:block @min-[44rem]:px-6 @min-[44rem]:py-3 @min-[44rem]:text-2xl">
          {tag}
        </span>
      )}
      <Icon name="arrow" className="h-8 w-8 shrink-0 text-subtle transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg" />
    </Link>
  );
}

// Factory Fab's and 3D Printing's launch boxes: the parts waiting in that area, and how many of
// them are released (not started yet). The icon, "parts" and the arrow show only when the box has
// room for them, so a narrow box keeps its name whole.
function AreaCard({ href, icon, title, count, released, glow }: { href: string; icon: "factory" | "printer"; title: string; count: number; released: number; glow?: boolean }) {
  return (
    <Link href={href} data-arrival={glow ? "" : undefined} className="@container card-interactive group flex min-w-0 items-center gap-5 p-4 active:scale-[0.98] @min-[16rem]:p-6">
      <span className="hidden h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-line-strong bg-raised text-accent-hover group-hover:border-accent/60 @min-[18rem]:flex">
        <Icon name={icon} className="h-8 w-8" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-medium text-muted @min-[14rem]:text-lg">{title}</div>
        <div className="display text-5xl text-accent tabular-nums @min-[14rem]:text-6xl">
          {count}
          <span className="hidden text-xl font-medium text-muted @min-[14rem]:inline @min-[20rem]:text-2xl"> {count === 1 ? "part" : "parts"}</span>
        </div>
        <div className="truncate text-sm text-subtle tabular-nums">{released} released</div>
      </div>
      <Icon name="arrow" className="hidden h-7 w-7 shrink-0 text-subtle transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg @min-[24rem]:block" />
    </Link>
  );
}

// A process's own page: a printer's on 3D Printing, a factory's on Factory Fab, else Shop Fab's tab.
function processHref(robotId: string, machine: string) {
  const area = areaOfMachine(machine);
  return area === "print" ? `/robots/${robotId}/printing/${machine}` : area === "factory" ? `/robots/${robotId}/factory/${machine}` : `/robots/${robotId}/fab?machine=${machine}`;
}
