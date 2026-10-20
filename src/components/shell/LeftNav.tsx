"use client";

import Link from "next/link";
import { useState } from "react";
import { MACHINES } from "@/config/machines";
import type { ShellRobot } from "@/lib/data/shell";
import { SignOutButton } from "@/components/SignOutButton";
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
  const base = robot ? `/robots/${robot.id}` : null;
  const onFab = !!base && pathname.startsWith(`${base}/fab`);
  const [fabOpen, setFabOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="block border-b border-line px-4 py-3.5">
        <div className="text-[15px] font-bold tracking-tight">OrbitBOM</div>
        <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Team 1690</div>
      </Link>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2 text-sm">
        <Item href="/" active={pathname === "/"}>
          Home
        </Item>
        <Item
          href={base}
          active={!!base && (pathname === base || pathname.startsWith(`${base}/systems`) || pathname.startsWith(`${base}/main`))}
        >
          Robot Dashboard
        </Item>
        <div>
          <div className="flex items-center">
            <Item href={base && `${base}/fab`} active={onFab} className="flex-1">
              To Fab
            </Item>
            {base && (
              <button
                onClick={() => setFabOpen((o) => !o)}
                aria-expanded={fabOpen || onFab}
                aria-label="Processes"
                className="rounded px-2 py-1.5 text-slate-500 hover:bg-raised hover:text-slate-100"
              >
                {fabOpen || onFab ? "▾" : "▸"}
              </button>
            )}
          </div>
          {base && (fabOpen || onFab) && (
            <div className="ml-3 border-l border-line pl-2">
              {MACHINES.map((m) => (
                <Item key={m.id} href={`${base}/fab?machine=${m.id}`} small>
                  {m.name}
                </Item>
              ))}
            </div>
          )}
        </div>
        <Item href={base && `${base}/review`} active={!!base && pathname.startsWith(`${base}/review`)}>
          To Review
        </Item>
        <Item href="/inventory" active={pathname.startsWith("/inventory")}>
          Inventory
        </Item>
      </nav>
      <div className="space-y-0.5 border-t border-line p-2 text-sm">
        <Item href="/members" active={pathname.startsWith("/members")}>
          Members
        </Item>
        <Item href="/profile" active={pathname.startsWith("/profile")}>
          Profile
        </Item>
        <div className="px-3 pt-2">
          <div className="truncate text-xs font-medium text-slate-300">{member.name}</div>
          <div className="truncate text-[11px] text-slate-500">
            {member.email}
            {member.isAdmin && " · Admin"}
          </div>
          <SignOutButton className="mt-1 text-xs" />
        </div>
      </div>
    </div>
  );
}

function Item({
  href,
  active = false,
  small = false,
  className = "",
  children,
}: {
  href: string | null;
  active?: boolean;
  small?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const cls = `block rounded-md px-3 ${small ? "py-1 text-xs" : "py-1.5"} transition-colors duration-75 ${className}`;
  if (!href) return <span className={`${cls} cursor-default text-slate-600`}>{children}</span>;
  return (
    <Link
      href={href}
      className={`${cls} ${active ? "bg-raised font-medium text-white shadow-[inset_2px_0_0_var(--color-accent)]" : "text-slate-400 hover:bg-raised hover:text-slate-100"}`}
    >
      {children}
    </Link>
  );
}
