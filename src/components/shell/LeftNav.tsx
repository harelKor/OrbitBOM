"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { CATEGORY_GROUPS } from "@/config/inventory";
import { MACHINES } from "@/config/machines";
import type { ShellCategory, ShellRobot } from "@/lib/data/shell";
import { Brand } from "./Brand";
import { SignOutButton } from "@/components/SignOutButton";
import { Icon, type IconName } from "@/components/ui/Icon";
import { FastLink, ShallowLink } from "@/components/ui/FastLink";
import { useRobotContext } from "./useRobotContext";

export function LeftNav({
  robots,
  lastRobotId,
  categories,
  member,
}: {
  robots: ShellRobot[];
  lastRobotId: string | null;
  categories: ShellCategory[];
  member: { name: string; email: string; isAdmin: boolean };
}) {
  const { pathname, robot } = useRobotContext(robots, lastRobotId);
  const query = useSearchParams();
  const machine = query.get("machine");
  const base = robot ? `/robots/${robot.id}` : null;
  const onFab = !!base && pathname.startsWith(`${base}/fab`);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const fabOpen = toggled ?? onFab;
  const onCots = pathname.startsWith("/cots");
  const [cotsToggled, setCotsToggled] = useState<boolean | null>(null);
  const cotsOpen = cotsToggled ?? onCots;
  const onInventory = pathname.startsWith("/inventory");
  const [inventoryToggled, setInventoryToggled] = useState<boolean | null>(null);
  const inventoryOpen = inventoryToggled ?? onInventory;
  // A group folder starts open while one of its categories (or the group itself) is showing.
  const [groupToggled, setGroupToggled] = useState<Record<string, boolean>>({});
  const shownCategory = pathname.startsWith("/inventory/c/") ? categories.find((c) => pathname === `/inventory/c/${c.id}`) : undefined;
  const shownGroup = pathname === "/inventory" ? query.get("group") : (shownCategory?.group ?? null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-14 items-center overflow-visible bg-bar px-3">
        <Brand />
      </div>
      {/* The column's edge line starts under the blue bar, so it never runs through the logo. */}
      <div className="flex min-h-0 flex-1 flex-col border-r border-line">
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2 text-sm">
          <Item href="/?home" icon="home" active={pathname === "/"}>
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
                  {robot!.fab.total > 0 && <Count n={robot!.fab.total} className="pointer-events-none absolute right-9" />}
                  <button
                    onClick={() => setToggled(!fabOpen)}
                    aria-expanded={fabOpen}
                    aria-label={fabOpen ? "Hide processes" : "Show processes"}
                    className="press absolute right-0 flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-line hover:text-fg"
                  >
                    <Icon name="chevron" className={`h-4.5 w-4.5 transition-transform duration-150 ${fabOpen ? "rotate-90" : ""}`} />
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
                    <ShallowLink
                      key={m.id}
                      href={`${base}/fab?machine=${m.id}`}
                      className={`press flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
                        active ? "bg-accent/15 text-white" : n ? "text-fg-2 hover:bg-raised hover:text-fg" : "text-subtle hover:bg-raised hover:text-fg-2"
                      }`}
                    >
                      <span className="truncate">{m.name}</span>
                      {n > 0 && <Count n={n} className="ml-auto" />}
                    </ShallowLink>
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
          <div>
            <div className="relative flex items-center">
              <Item href="/cots" icon="cart" active={pathname === "/cots"} className="flex-1 pr-8">
                COTS
              </Item>
              <button
                onClick={() => setCotsToggled(!cotsOpen)}
                aria-expanded={cotsOpen}
                aria-label={cotsOpen ? "Hide COTS lists" : "Show COTS lists"}
                className="press absolute right-0 flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-line hover:text-fg"
              >
                <Icon name="chevron" className={`h-4.5 w-4.5 transition-transform duration-150 ${cotsOpen ? "rotate-90" : ""}`} />
              </button>
            </div>
            {cotsOpen && (
              <div className="mt-0.5 mb-1 ml-5 space-y-px border-l border-line pl-2">
                {[
                  { href: "/cots/released", name: "Released" },
                  { href: "/cots/order-list", name: "Order List" },
                ].map((l) => (
                  <FastLink
                    key={l.href}
                    href={l.href}
                    className={`press flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
                      pathname === "/inventory" && `/inventory?${query.toString()}` === l.href ? "bg-accent/15 text-white" : "text-fg-2 hover:bg-raised hover:text-fg"
                    }`}
                  >
                    {l.name}
                  </FastLink>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="relative flex items-center">
              <Item href="/inventory" icon="box" active={pathname === "/inventory"} className="flex-1 pr-8">
                Inventory
              </Item>
              <button
                onClick={() => setInventoryToggled(!inventoryOpen)}
                aria-expanded={inventoryOpen}
                aria-label={inventoryOpen ? "Hide inventory categories" : "Show inventory categories"}
                className="press absolute right-0 flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-line hover:text-fg"
              >
                <Icon name="chevron" className={`h-4.5 w-4.5 transition-transform duration-150 ${inventoryOpen ? "rotate-90" : ""}`} />
              </button>
            </div>
            {inventoryOpen && (
              <div className="mt-0.5 mb-1 ml-5 space-y-px border-l border-line pl-2">
                {[
                  { href: "/inventory?view=season", name: "Short for season", view: "season" },
                  { href: "/inventory?view=robots", name: "Short for robots", view: "robots" },
                ].map((l) => (
                  <ShallowLink
                    key={l.href}
                    href={l.href}
                    className={`press flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
                      pathname === "/inventory" && query.get("view") === l.view ? "bg-accent/15 text-white" : "text-fg-2 hover:bg-raised hover:text-fg"
                    }`}
                  >
                    {l.name}
                  </ShallowLink>
                ))}
                {CATEGORY_GROUPS.map((g) => {
                  const children = categories.filter((c) => c.group === g.id);
                  const open = groupToggled[g.id] ?? shownGroup === g.id;
                  const active = pathname === "/inventory" && query.get("group") === g.id;
                  return (
                    <div key={g.id}>
                      <div className="relative flex items-center">
                        <ShallowLink
                          href={`/inventory?group=${g.id}`}
                          className={`press flex flex-1 items-center gap-2 rounded-md py-1 pr-7 pl-2 text-xs ${
                            active ? "bg-accent/15 text-white" : "text-fg-2 hover:bg-raised hover:text-fg"
                          }`}
                        >
                          <span className="truncate">{g.label}</span>
                          {children.length > 0 && <Count n={children.length} className="ml-auto" />}
                        </ShallowLink>
                        {children.length > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setGroupToggled((t) => ({ ...t, [g.id]: !open }));
                            }}
                            aria-expanded={open}
                            aria-label={`${open ? "Hide" : "Show"} ${g.label} categories`}
                            className="press absolute right-0 flex h-6 w-6 items-center justify-center rounded-md text-subtle hover:bg-line hover:text-fg"
                          >
                            <Icon name="chevron" className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
                          </button>
                        )}
                      </div>
                      {open && (
                        <div className="mt-px mb-1 ml-3 space-y-px border-l border-line pl-2">
                          {children.map((c) => (
                            <FastLink
                              key={c.id}
                              href={`/inventory/c/${c.id}`}
                              aria-current={shownCategory?.id === c.id ? "page" : undefined}
                              className={`press block truncate rounded-md px-2 py-0.5 text-[11px] ${
                                shownCategory?.id === c.id ? "bg-accent/15 text-white" : "text-muted hover:bg-raised hover:text-fg"
                              }`}
                            >
                              {c.label}
                            </FastLink>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
    <FastLink
      href={href}
      aria-current={active ? "page" : undefined}
      className={`${cls} ${active ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:bg-raised hover:text-fg"}`}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />}
      <Icon name={icon} className={`h-4 w-4 ${active ? "text-accent-hover" : ""}`} />
      {children}
    </FastLink>
  );
}
