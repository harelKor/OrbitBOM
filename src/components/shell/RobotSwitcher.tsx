"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FastLink } from "@/components/ui/FastLink";
import { NewSystemButton } from "@/app/(app)/robots/[robotId]/NewSystemButton";
import { RobotSettings } from "@/app/(app)/robots/[robotId]/RobotSettings";
import { SystemSettings } from "@/app/(app)/robots/[robotId]/systems/[systemId]/SystemSettings";
import type { ShellRobot, ShellSystem } from "@/lib/data/shell";
import { AppearanceControls } from "./Appearance";
import { EditOnly } from "./ModeContext";
import { selectRobot, useRobotContext } from "./useRobotContext";

// Robots, and the active robot's systems, one click away on every page. In Edit mode each
// robot card and system tile has its settings gear in the corner. Clicking another robot on one of a
// robot's pages (dashboard, To Fab, Factory Fab, To Review, inventory) opens the same page for it at
// once (Harel, 2026-11-04); elsewhere (a system, a page without a robot) it selects the robot (side
// links and its systems follow it, the page stays). Clicking the selected one opens its dashboard.
const ROBOT_PAGE = /^\/robots\/[0-9a-f-]{36}((?:\/(?:fab|review|cad-review|inventory|main|(?:factory|printing)(?:\/[\w-]+)?))?)\/?$/;
export function RobotSwitcher({ robots, lastRobotId, isAdmin }: { robots: ShellRobot[]; lastRobotId: string | null; isAdmin: boolean }) {
  const { pathname, robot: current, systemId } = useRobotContext(robots, lastRobotId);
  const query = useSearchParams().toString();
  const page = pathname.match(ROBOT_PAGE);
  // The same page for another robot, or null where the page stays and only the pick changes.
  const samePage = (id: string) => (page ? `/robots/${id}${page[1]}${query ? `?${query}` : ""}` : null);
  const active = robots.filter((r) => !r.archived);
  const archived = robots.filter((r) => r.archived);
  const expanded = current;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div data-wco-bar="" data-wco-robots="" className="flex min-h-11 flex-wrap items-center justify-between gap-x-2 bg-bar px-4 text-white">
        <span className="text-sm font-semibold">Robots</span>
        <EditOnly>
          <Link href="/robots/new" className="press rounded-md border border-white/40 px-2 py-1 text-xs font-semibold hover:bg-white/10">
            + New robot
          </Link>
        </EditOnly>
      </div>
      <div className="space-y-2 p-2">
        {active.length === 0 && <p className="px-2 py-4 text-sm text-subtle">No robots yet.</p>}
        {active.map((r) => (
          <RobotCard
            key={r.id}
            robot={r}
            current={r.id === current?.id}
            overview={r.id === current?.id && !systemId && !pathname.includes("/fab") && !pathname.includes("/factory") && !pathname.includes("/printing") && !pathname.includes("/review")}
            isAdmin={isAdmin}
            samePage={samePage(r.id)}
            onSelect={() => selectRobot(r.id)}
          />
        ))}
      </div>

      {expanded && (
        <div className="border-t border-line p-2">
          <div className="flex items-center justify-between gap-2 px-1 pt-1 pb-2">
            <span className="truncate text-xs font-semibold text-muted">{expanded.name} systems</span>
            <EditOnly>
              <NewSystemButton robotId={expanded.id} small />
            </EditOnly>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {expanded.systems.map((s) => (
              <SystemTile key={s.id} robotId={expanded.id} system={s} active={s.id === systemId} isAdmin={isAdmin} pathname={pathname} />
            ))}
          </div>
          {expanded.systems.length === 0 && <p className="px-2 text-xs text-subtle">No systems yet.</p>}
        </div>
      )}

      {archived.length > 0 && (
        <details className="border-t border-line p-2 text-sm">
          <summary className="cursor-pointer px-2 py-1 text-xs text-subtle">Archived ({archived.length})</summary>
          <div className="mt-2 space-y-2">
            {archived.map((r) => (
              <RobotCard
                key={r.id}
                robot={r}
                current={r.id === current?.id}
                overview={false}
                isAdmin={isAdmin}
                samePage={samePage(r.id)}
                onSelect={() => selectRobot(r.id)}
              />
            ))}
          </div>
        </details>
      )}
      <div className="mt-auto">
        <AppearanceControls />
      </div>
    </div>
  );
}

function RobotCard({
  robot,
  current,
  overview,
  isAdmin,
  samePage,
  onSelect,
}: {
  robot: ShellRobot;
  current: boolean;
  overview: boolean;
  isAdmin: boolean;
  samePage: string | null;
  onSelect: () => void;
}) {
  return (
    <div className="relative">
      <FastLink
        href={(!current && samePage) || `/robots/${robot.id}`}
        aria-current={overview ? "page" : undefined}
        aria-pressed={current}
        data-selected={current}
        title={current ? "Open dashboard" : samePage ? "Switch to this robot" : "Select robot"}
        onClick={(e) => {
          // On a robot's page the link opens that page for this robot; elsewhere the first click
          // selects the robot without leaving the page. A new-tab click follows the link.
          if (current || samePage || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onSelect();
        }}
        className="card-interactive group flex items-center gap-3 p-2"
      >
        <Picture url={robot.thumbUrl} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{robot.name}</div>
          <div className="text-xs text-subtle tabular-nums">
            {robot.year}, {robot.percent}% done
          </div>
        </div>
      </FastLink>
      <EditOnly>
        <span className="absolute top-1.5 right-1.5">
          <RobotSettings robot={robot} isAdmin={isAdmin} small />
        </span>
      </EditOnly>
    </div>
  );
}

// Where a system tile leads (Harel, 2026-11-09): from a CAD page to the system's CAD page, from a
// BOM page (a robot's dashboard or a system) to its BOM page; anywhere else it asks which.
const BOM_PAGE = /^\/robots\/[0-9a-f-]{36}(?:\/systems\/[0-9a-f-]{36})?\/?$/;
function SystemTile({ robotId, system, active, isAdmin, pathname }: { robotId: string; system: ShellSystem; active: boolean; isAdmin: boolean; pathname: string }) {
  const [asking, setAsking] = useState(false);
  const bom = `/robots/${robotId}/systems/${system.id}`;
  const cad = `${bom}/cad-review`;
  const inCad = pathname.includes("/cad-review");
  const ask = !inCad && !BOM_PAGE.test(pathname);
  useEffect(() => {
    if (!asking) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      setAsking(false);
    };
    const t = setTimeout(() => document.addEventListener("click", close), 0);
    document.addEventListener("keydown", close);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [asking]);
  return (
    <div className="relative">
      {asking && (
        <div className="absolute inset-x-1 top-1/3 z-20 flex animate-pop gap-1 rounded-md border border-line bg-surface p-1 shadow-lg">
          <FastLink href={bom} className="btn h-9 flex-1 justify-center px-1 text-xs active:scale-[0.98]">
            BOM
          </FastLink>
          <FastLink href={cad} className="btn h-9 flex-1 justify-center px-1 text-xs active:scale-[0.98]">
            CAD
          </FastLink>
        </div>
      )}
      <FastLink
        href={inCad ? cad : bom}
        onClick={(e) => {
          if (!ask) return;
          e.preventDefault();
          setAsking(true);
        }}
        aria-current={active ? "page" : undefined}
        data-selected={active}
        className="card-interactive group block"
        title={system.name}
      >
        <span className="relative block">
          <Picture url={system.thumbUrl} className="aspect-square w-full rounded-none" />
          <span
            className={`absolute right-1.5 bottom-1.5 rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums ${
              system.percent === 100 ? "bg-accent text-white" : "bg-[#111318]/85 text-white"
            }`}
          >
            {system.percent}%
          </span>
        </span>
        <span className={`block truncate px-2 py-1.5 text-xs font-medium ${active ? "text-accent" : "text-fg-2"}`}>{system.name}</span>
      </FastLink>
      {system.sync.outdated && (
        <FastLink
          href={`/robots/${robotId}/systems/${system.id}?versions=1`}
          className="press absolute top-1.5 left-1.5 rounded-full bg-rose-500 px-1.5 py-px text-[10px] font-bold text-white shadow-sm hover:bg-rose-600"
          title={
            system.sync.outdated === "reverted"
              ? "Reverted to an older version: some parts are behind the latest one. Open Versions."
              : "Some parts of the last update weren't committed yet. Open Versions."
          }
        >
          Outdated
        </FastLink>
      )}
      <EditOnly>
        <span className="absolute top-1.5 right-1.5">
          <SystemSettings robotId={robotId} system={system} isAdmin={isAdmin} small />
        </span>
      </EditOnly>
    </div>
  );
}

function Picture({ url, className }: { url: string | null; className: string }) {
  return (
    <span className={`thumb-well flex shrink-0 items-center justify-center rounded ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
        <img src={url} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
      ) : (
        <span className="text-[10px] text-muted">No image</span>
      )}
    </span>
  );
}
