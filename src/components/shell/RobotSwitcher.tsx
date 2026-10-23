"use client";

import Link from "next/link";
import { FastLink } from "@/components/ui/FastLink";
import { NewSystemButton } from "@/app/(app)/robots/[robotId]/NewSystemButton";
import { RobotSettings } from "@/app/(app)/robots/[robotId]/RobotSettings";
import { SystemSettings } from "@/app/(app)/robots/[robotId]/systems/[systemId]/SystemSettings";
import type { ShellRobot, ShellSystem } from "@/lib/data/shell";
import { AppearanceControls } from "./Appearance";
import { EditOnly } from "./ModeContext";
import { useRobotContext } from "./useRobotContext";

// Robots, and the active robot's systems, one click away on every page. In Edit mode each
// robot card and system tile has its settings gear in the corner.
export function RobotSwitcher({ robots, lastRobotId, isAdmin }: { robots: ShellRobot[]; lastRobotId: string | null; isAdmin: boolean }) {
  const { pathname, robot: current, systemId } = useRobotContext(robots, lastRobotId);
  const active = robots.filter((r) => !r.archived);
  const archived = robots.filter((r) => r.archived);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex min-h-14 items-center justify-between bg-bar px-4 text-white">
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
            overview={r.id === current?.id && !systemId && !pathname.includes("/fab") && !pathname.includes("/review")}
            isAdmin={isAdmin}
          />
        ))}
      </div>

      {current && (
        <div className="border-t border-line p-2">
          <div className="flex items-center justify-between gap-2 px-1 pt-1 pb-2">
            <span className="truncate text-xs font-semibold text-muted">{current.name} systems</span>
            <EditOnly>
              <NewSystemButton robotId={current.id} small />
            </EditOnly>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {current.systems.map((s) => (
              <SystemTile key={s.id} robotId={current.id} system={s} active={s.id === systemId} isAdmin={isAdmin} />
            ))}
          </div>
          {current.systems.length === 0 && <p className="px-2 text-xs text-subtle">No systems yet.</p>}
        </div>
      )}

      {archived.length > 0 && (
        <details className="border-t border-line p-2 text-sm">
          <summary className="cursor-pointer px-2 py-1 text-xs text-subtle">Archived ({archived.length})</summary>
          <div className="mt-2 space-y-2">
            {archived.map((r) => (
              <RobotCard key={r.id} robot={r} current={r.id === current?.id} overview={false} isAdmin={isAdmin} />
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

function RobotCard({ robot, current, overview, isAdmin }: { robot: ShellRobot; current: boolean; overview: boolean; isAdmin: boolean }) {
  return (
    <div className="relative">
      <FastLink
        href={`/robots/${robot.id}`}
        aria-current={overview ? "page" : undefined}
        data-selected={overview}
        className={`card-interactive group flex items-center gap-3 p-2 ${current && !overview ? "border-white/20" : ""}`}
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

function SystemTile({ robotId, system, active, isAdmin }: { robotId: string; system: ShellSystem; active: boolean; isAdmin: boolean }) {
  return (
    <div className="relative">
      <FastLink
        href={`/robots/${robotId}/systems/${system.id}`}
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
