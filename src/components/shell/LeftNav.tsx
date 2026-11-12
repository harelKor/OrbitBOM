"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { CATEGORY_GROUPS } from "@/config/inventory";
import { FACTORY_FAB_MACHINES, MACHINES, PRINTERS, areaOfMachine } from "@/config/machines";
import type { ShellCategory, ShellRobot } from "@/lib/data/shell";
import { Brand } from "./Brand";
import { SignOutButton } from "@/components/SignOutButton";
import { Icon, type IconName } from "@/components/ui/Icon";
import { FastLink, ShallowLink } from "@/components/ui/FastLink";
import { useManage } from "./ModeContext";
import { useRobotContext } from "./useRobotContext";
import { useArrivals } from "./Arrivals";
import { InstallApp } from "./InstallApp";

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
  const canManage = useManage();
  // New parts this member hasn't seen glow in their pages' links (src/lib/seen.ts).
  const arrivals = useArrivals();
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
      {/* Narrower than the full mark, only the round logo stays. */}
      <div data-wco-bar="" className="flex min-h-11 items-center overflow-visible bg-bar px-3 @max-[13.5rem]:[&_a>span]:hidden">
        <Brand />
      </div>
      {/* The column's edge line starts under the blue bar, so it never runs through the logo. The
          links zoom when the column is dragged wider than they need (Shell's NavResizer); the
          logo bar doesn't, so it stays level with the top bar. Dragged narrower than 10rem only
          the icons stay (each link keeps its name as a tooltip). */}
      <div data-nav-body style={{ zoom: "var(--nav-zoom, 1)" }} className="flex min-h-0 flex-1 flex-col border-r border-line">
        <nav className="flex-1 space-y-0.5 overflow-x-hidden overflow-y-auto p-2 text-sm">
          <Item href="/" icon="home" active={pathname === "/"}>
            Home
          </Item>
          <Item
            href={base}
            icon="gauge"
            active={!!base && (pathname === base || (pathname.startsWith(`${base}/systems`) && !pathname.endsWith("/cad-review")))}
          >
            Robot Dashboard
          </Item>
          <div>
            <div className="relative flex items-center">
              <Item href={base && `${base}/fab`} icon="fab" active={onFab && !machine} glow={!!robot && arrivals.page(`fab:${robot.id}`)} className="flex-1 pr-14">
                Shop Fab
              </Item>
              {base && (
                <>
                  {robot!.fab.total > 0 && <Count n={robot!.fab.total} className="pointer-events-none absolute right-9 @max-[10rem]:hidden" />}
                  <button
                    onClick={() => setToggled(!fabOpen)}
                    aria-expanded={fabOpen}
                    aria-label={fabOpen ? "Hide processes" : "Show processes"}
                    className="press absolute right-0 flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-line hover:text-fg @max-[10rem]:hidden"
                  >
                    <Icon name="chevron" className={`h-4.5 w-4.5 transition-transform duration-150 ${fabOpen ? "rotate-90" : ""}`} />
                  </button>
                </>
              )}
            </div>
            {base && fabOpen && (
              <div className="mt-0.5 mb-1 ml-5 @max-[10rem]:hidden space-y-px border-l border-line pl-2">
                {/* A factory's or team printer's parts are on Factory Fab or 3D Printing, below. */}
                {MACHINES.filter((m) => !areaOfMachine(m.id)).map((m) => {
                  const n = robot!.fab.byMachine[m.id] ?? 0;
                  const active = onFab && machine === m.id;
                  return (
                    <ShallowLink
                      key={m.id}
                      href={`${base}/fab?machine=${m.id}`}
                      className={`press flex items-center gap-2 rounded-md px-2 py-1 text-xs pointer-coarse:min-h-9 ${
                        active ? "bg-accent/15 text-white" : n ? "text-fg-2 hover:bg-raised hover:text-fg" : "text-subtle hover:bg-raised hover:text-fg-2"
                      }`}
                    >
                      <span className={`truncate ${arrivals.tab(`fab:${robot!.id}`, m.id) ? "arrival-text" : ""}`}>{m.name}</span>
                      {n > 0 && <Count n={n} className="ml-auto" />}
                    </ShallowLink>
                  );
                })}
              </div>
            )}
          </div>
          <AreaNav
            base={base && `${base}/printing`}
            pathname={pathname}
            icon="printer"
            label="3D Printing"
            what="printers"
            machines={PRINTERS}
            total={robot?.print.total ?? 0}
            counts={robot?.print.byPrinter ?? {}}
            glowOf={(id) => !!robot && arrivals.page(`print:${robot.id}:${id}`)}
          />
          <AreaNav
            base={base && `${base}/factory`}
            pathname={pathname}
            icon="factory"
            label="Factory Fab"
            what="factories"
            machines={FACTORY_FAB_MACHINES}
            total={robot?.factory.total ?? 0}
            counts={robot?.factory.byFactory ?? {}}
            glowOf={(id) => !!robot && arrivals.page(`factory:${robot.id}:${id}`)}
          />
          <div>
            <div className="relative flex items-center">
              <Item href="/cots" icon="cart" active={pathname === "/cots"} glow={arrivals.page("cots:released") || arrivals.page("cots:order")} className="flex-1 pr-8">
                Orders
              </Item>
              <button
                onClick={() => setCotsToggled(!cotsOpen)}
                aria-expanded={cotsOpen}
                aria-label={cotsOpen ? "Hide Orders lists" : "Show Orders lists"}
                className="press absolute right-0 flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-line hover:text-fg @max-[10rem]:hidden"
              >
                <Icon name="chevron" className={`h-4.5 w-4.5 transition-transform duration-150 ${cotsOpen ? "rotate-90" : ""}`} />
              </button>
            </div>
            {cotsOpen && (
              <div className="mt-0.5 mb-1 ml-5 @max-[10rem]:hidden space-y-px border-l border-line pl-2">
                {[
                  { href: "/cots/released", name: "Released", page: "cots:released" },
                  { href: "/cots/order-list", name: "Order List", page: "cots:order" },
                  { href: "/cots/history", name: "Order History", page: null },
                ].map((l) => (
                  <FastLink
                    key={l.href}
                    href={l.href}
                    className={`press flex items-center gap-2 rounded-md px-2 py-1 text-xs pointer-coarse:min-h-9 ${
                      pathname === l.href ? "bg-accent/15 text-white" : "text-fg-2 hover:bg-raised hover:text-fg"
                    }`}
                  >
                    <span className={l.page && arrivals.page(l.page) ? "arrival-text" : undefined}>{l.name}</span>
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
                className="press absolute right-0 flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-line hover:text-fg @max-[10rem]:hidden"
              >
                <Icon name="chevron" className={`h-4.5 w-4.5 transition-transform duration-150 ${inventoryOpen ? "rotate-90" : ""}`} />
              </button>
            </div>
            {inventoryOpen && (
              <div className="mt-0.5 mb-1 ml-5 @max-[10rem]:hidden space-y-px border-l border-line pl-2">
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
                              className={`press block truncate rounded-md px-2 py-0.5 text-[0.6875rem] ${
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
          <Item href={base && `${base}/cad-review`} icon="gears" active={pathname.includes("/cad-review")}>
            CAD
          </Item>
          <Item href={base && `${base}/assembly`} icon="screw" active={pathname.endsWith("/assembly")}>
            Assembly
          </Item>
          {/* Was To Review, near the top (Harel, 2026-11-11). */}
          <div className="relative flex items-center">
            <Item href={base && `${base}/review`} icon="review" active={!!base && pathname.startsWith(`${base}/review`)} className="flex-1 pr-14">
              AI review
            </Item>
            {base && robot!.review > 0 && <Count n={robot!.review} className="pointer-events-none absolute right-8 @max-[10rem]:hidden" />}
          </div>
          <Item href="/ai-logs" icon="spark" active={pathname.startsWith("/ai-logs")}>
            AI logs
          </Item>
        </nav>
        <InstallApp />
        <div className="space-y-0.5 border-t border-line p-2 text-sm">
          <Item href="/members" icon="users" active={pathname.startsWith("/members")}>
            Members
          </Item>
          <Item href="/profile" icon="user" active={pathname.startsWith("/profile")}>
            Profile
          </Item>
          {canManage && (
            <Item href="/settings" icon="gear" active={pathname.startsWith("/settings")}>
              Settings
            </Item>
          )}
          <div className="px-3 pt-2 @max-[10rem]:hidden">
            <div className="truncate text-xs font-medium text-fg-2">{member.name}</div>
            <div className="truncate text-[0.6875rem] text-subtle">
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
    <span className={`rounded-full bg-raised px-1.5 text-[0.625rem] leading-4 font-semibold text-fg-2 tabular-nums ${className}`}>{n}</span>
  );
}

function Item({
  href,
  icon,
  active = false,
  glow = false,
  className = "",
  children,
}: {
  href: string | null;
  icon: IconName;
  active?: boolean;
  glow?: boolean; // new parts arrived there since this member last looked (src/lib/seen.ts)
  className?: string;
  children: React.ReactNode;
}) {
  const cls = `press relative flex items-center gap-2.5 rounded-md px-3 py-1.5 ${className}`;
  // Cut short with an ellipsis in a narrowed column; screen readers only once just icons show.
  const name = <span className={`truncate @max-[10rem]:sr-only ${glow ? "arrival-text" : ""}`}>{children}</span>;
  if (!href)
    return (
      <span className={`${cls} cursor-default text-faint`} title="Create a robot first">
        <Icon name={icon} />
        {name}
      </span>
    );
  return (
    <FastLink
      href={href}
      aria-current={active ? "page" : undefined}
      title={typeof children === "string" ? children : undefined}
      className={`${cls} ${active ? "bg-accent/10 font-semibold text-accent" : "text-muted hover:bg-raised hover:text-fg"}`}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" />}
      <Icon name={icon} className={`h-4 w-4 shrink-0 ${active ? "text-accent-hover" : ""} ${glow ? "arrival-text" : ""}`} />
      {name}
    </FastLink>
  );
}

// 3D Printing and Factory Fab: the page, its count, and a dropdown of its printers or factories
// with theirs (Harel, 2026-11-04).
function AreaNav({
  base,
  pathname,
  icon,
  label,
  what,
  machines,
  total,
  counts,
  glowOf,
}: {
  base: string | null;
  pathname: string;
  icon: IconName;
  label: string;
  what: string;
  machines: readonly { id: string; name: string }[];
  total: number;
  counts: Record<string, number>;
  glowOf: (machineId: string) => boolean; // that printer's or factory's page has unseen new parts
}) {
  const on = !!base && pathname.startsWith(base);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? on;
  return (
    <div>
      <div className="relative flex items-center">
        <Item href={base} icon={icon} active={!!base && pathname === base} glow={machines.some((m) => glowOf(m.id))} className="flex-1 pr-14">
          {label}
        </Item>
        {base && (
          <>
            {total > 0 && <Count n={total} className="pointer-events-none absolute right-9 @max-[10rem]:hidden" />}
            <button
              onClick={() => setToggled(!open)}
              aria-expanded={open}
              aria-label={open ? `Hide ${what}` : `Show ${what}`}
              className="press absolute right-0 flex h-8 w-8 items-center justify-center rounded-md text-subtle hover:bg-line hover:text-fg @max-[10rem]:hidden"
            >
              <Icon name="chevron" className={`h-4.5 w-4.5 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
            </button>
          </>
        )}
      </div>
      {base && open && (
        <div className="mt-0.5 mb-1 ml-5 @max-[10rem]:hidden space-y-px border-l border-line pl-2">
          {machines.map((m) => {
            const n = counts[m.id] ?? 0;
            const href = `${base}/${m.id}`;
            return (
              <FastLink
                key={m.id}
                href={href}
                className={`press flex items-center gap-2 rounded-md px-2 py-1 text-xs pointer-coarse:min-h-9 ${
                  pathname === href ? "bg-accent/15 text-white" : n ? "text-fg-2 hover:bg-raised hover:text-fg" : "text-subtle hover:bg-raised hover:text-fg-2"
                }`}
              >
                <span className={`truncate ${glowOf(m.id) ? "arrival-text" : ""}`}>{m.name}</span>
                {n > 0 && <Count n={n} className="ml-auto" />}
              </FastLink>
            );
          })}
        </div>
      )}
    </div>
  );
}
