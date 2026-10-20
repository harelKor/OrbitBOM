"use client";

import Link from "next/link";
import type { ShellRobot, ShellSystem } from "@/lib/data/shell";
import { EditOnly } from "./ModeContext";
import { useRobotContext } from "./useRobotContext";

// Robots, and the active robot's systems, one click away on every page.
export function RobotSwitcher({ robots, lastRobotId }: { robots: ShellRobot[]; lastRobotId: string | null }) {
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
          <RobotCard key={r.id} robot={r} current={r.id === current?.id} overview={r.id === current?.id && !systemId && !pathname.includes("/fab") && !pathname.includes("/review")} />
        ))}
      </div>

      {current && (
        <div className="border-t border-line p-2">
          <div className="px-1 pt-1 pb-2 text-xs font-semibold text-muted">{current.name} systems</div>
          <div className="grid grid-cols-2 gap-2">
            {current.systems.map((s) => (
              <SystemTile key={s.id} robotId={current.id} system={s} active={s.id === systemId} />
            ))}
          </div>
          {current.systems.length === 0 && <p className="px-2 text-xs text-subtle">No systems yet.</p>}
        </div>
      )}

      {archived.length > 0 && (
        <details className="mt-auto border-t border-line p-2 text-sm">
          <summary className="cursor-pointer px-2 py-1 text-xs text-subtle">Archived ({archived.length})</summary>
          <div className="mt-2 space-y-2">
            {archived.map((r) => (
              <RobotCard key={r.id} robot={r} current={r.id === current?.id} overview={false} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function RobotCard({ robot, current, overview }: { robot: ShellRobot; current: boolean; overview: boolean }) {
  return (
    <Link
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
    </Link>
  );
}

function SystemTile({ robotId, system, active }: { robotId: string; system: ShellSystem; active: boolean }) {
  return (
    <Link
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
    </Link>
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
