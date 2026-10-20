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
      <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Robots</span>
        <EditOnly>
          <Link href="/robots/new" className="text-xs font-medium text-accent-soft hover:text-white">
            + New robot
          </Link>
        </EditOnly>
      </div>
      <div className="space-y-2 p-2">
        {active.length === 0 && <p className="px-2 py-4 text-sm text-slate-500">No robots yet.</p>}
        {active.map((r) => (
          <RobotCard key={r.id} robot={r} current={r.id === current?.id} overview={r.id === current?.id && !systemId && !pathname.includes("/fab") && !pathname.includes("/review")} />
        ))}
      </div>

      {current && (
        <div className="border-t border-line p-2">
          <div className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            {current.name} systems
          </div>
          <div className="grid grid-cols-2 gap-2">
            {current.systems.map((s) => (
              <SystemTile key={s.id} robotId={current.id} system={s} active={s.id === systemId} />
            ))}
          </div>
          {current.systems.length === 0 && <p className="px-2 text-xs text-slate-500">No systems yet.</p>}
        </div>
      )}

      {archived.length > 0 && (
        <details className="mt-auto border-t border-line p-2 text-sm">
          <summary className="cursor-pointer px-2 py-1 text-xs text-slate-500">Archived ({archived.length})</summary>
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
      className={`flex items-center gap-3 rounded-md border p-2 transition-colors duration-75 ${
        overview ? "border-accent bg-raised" : current ? "border-line-strong bg-raised" : "border-line hover:border-line-strong hover:bg-raised"
      }`}
    >
      <Picture url={robot.thumbUrl} className="h-12 w-12" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{robot.name}</div>
        <div className="text-xs text-slate-500">
          {robot.year} · {robot.percent}%
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
      className={`block overflow-hidden rounded-md border transition-colors duration-75 ${
        active ? "border-accent" : "border-line hover:border-line-strong"
      }`}
    >
      <Picture url={system.thumbUrl} className="aspect-square w-full rounded-none" />
      <div className="bg-raised px-2 py-1.5">
        <div className="truncate text-xs font-medium">{system.name}</div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-emerald-500" style={{ width: `${system.percent}%` }} />
        </div>
      </div>
    </Link>
  );
}

function Picture({ url, className }: { url: string | null; className: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded bg-well ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
        <img src={url} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
      ) : (
        <span className="text-[10px] text-slate-400">No image</span>
      )}
    </span>
  );
}
