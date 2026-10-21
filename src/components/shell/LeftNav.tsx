"use client";

import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { MACHINES } from "@/config/machines";
import type { ShellRobot } from "@/lib/data/shell";
import { SignOutButton } from "@/components/SignOutButton";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useRobotContext } from "./useRobotContext";

export function LeftNav({
  robots,
  lastRobotId,
  member,
}: {
  robots: ShellRobot[];
  lastRobotId: string | null;
  member: { name: string; email: string; isAdmin: boolean };
}) {
  const { pathname, robot } = useRobotContext(robots, lastRobotId);
  const machine = useSearchParams().get("machine");
  const base = robot ? `/robots/${robot.id}` : null;
  const onFab = !!base && pathname.startsWith(`${base}/fab`);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const fabOpen = toggled ?? onFab;

  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="flex min-h-14 items-center gap-2.5 bg-bar px-4 text-white" aria-label="OrbitMech home">
        <Image src="/orbit-logo.png" alt="" width={34} height={34} className="h-[34px] w-[34px] rounded-md" priority />
        <span className="display text-[26px] leading-none">1690</span>
        <span className="leading-tight">
          <span className="block text-[13px] font-semibold tracking-[0.12em]">ORBIT</span>
          <span className="block text-[11px] tracking-[0.12em] text-white/75">MECH</span>
        </span>
      </Link>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2 text-sm">
        <Item href="/" icon="home" active={pathname === "/"}>
          Home
        </Item>
        <Item
          href={base}
          icon="gauge"
          active={!!base && (pathname === base || pathname.startsWith(`${base}/systems`))}
        >
          Robot Dashboard
        </Item>
        <div>
          <div className="relative flex items-center">
            <Item href={base && `${base}/fab`} icon="fab" active={onFab && !machine} className="flex-1 pr-14">
              To Fab
            </Item>
            {base && (
              <>
                {robot!.fab.total > 0 && <Count n={robot!.fab.total} className="pointer-events-none absolute right-8" />}
                <button
                  onClick={() => setToggled(!fabOpen)}
                  aria-expanded={fabOpen}
                  aria-label={fabOpen ? "Hide processes" : "Show processes"}
                  className="press absolute right-1 rounded p-1 text-subtle hover:bg-line hover:text-fg"
                >
                  <Icon name="chevron" className={`h-3.5 w-3.5 transition-transform duration-150 ${fabOpen ? "rotate-90" : ""}`} />
                </button>
              </>
            )}
          </div>
          {base && fabOpen && (
            <div className="mt-0.5 mb-1 ml-5 space-y-px border-l border-line pl-2">
              {MACHINES.map((m) => {
                const n = robot!.fab.byMachine[m.id] ?? 0;
                const active = onFab && machine === m.id;
                return (
                  <Link
                    key={m.id}
                    href={`${base}/fab?machine=${m.id}`}
                    className={`press flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
                      active ? "bg-accent/15 text-white" : n ? "text-fg-2 hover:bg-raised hover:text-fg" : "text-subtle hover:bg-raised hover:text-fg-2"
                    }`}
                  >
                    <span className="truncate">{m.name}</span>
                    {n > 0 && <Count n={n} className="ml-auto" />}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        <div className="relative flex items-center">
          <Item href={base && `${base}/review`} icon="review" active={!!base && pathname.startsWith(`${base}/review`)} className="flex-1 pr-14">
            To Review
          </Item>
          {base && robot!.review > 0 && <Count n={robot!.review} className="pointer-events-none absolute right-8" />}
        </div>
        <Item href="/inventory" icon="box" active={pathname.startsWith("/inventory")}>
          Inventory
        </Item>
        <Item href="/ai-logs" icon="spark" active={pathname.startsWith("/ai-logs")}>
          AI logs
        </Item>
      </nav>
      <div className="space-y-0.5 border-t border-line p-2 text-sm">
        <Item href="/members" icon="users" active={pathname.startsWith("/members")}>
          Members
        </Item>
        <Item href="/profile" icon="user" active={pathname.startsWith("/profile")}>
          Profile
        </Item>
        <div className="px-3 pt-2">
          <div className="truncate text-xs font-medium text-fg-2">{member.name}</div>
          <div className="truncate text-[11px] text-subtle">
            {member.email}
            {member.isAdmin && ", admin"}
          </div>
          <SignOutButton className="mt-1 text-xs" />
        </div>
      </div>
    </div>
  );
}

function Count({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span className={`rounded-full bg-raised px-1.5 text-[10px] leading-4 font-semibold text-fg-2 tabular-nums ${className}`}>{n}</span>
  );
}

function Item({
  href,
  icon,
  active = false,
  className = "",
  children,
}: {
  href: string | null;
  icon: IconName;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const cls = `press relative flex items-center gap-2.5 rounded-md px-3 py-1.5 ${className}`;
  if (!href)
    return (
      <span className={`${cls} cursor-default text-faint`} title="Create a robot first">
        <Icon name={icon} />
        {children}
      </span>
    );
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${cls} ${active ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:bg-raised hover:text-fg"}`}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />}
      <Icon name={icon} className={`h-4 w-4 ${active ? "text-accent-hover" : ""}`} />
      {children}
    </Link>
  );
}
