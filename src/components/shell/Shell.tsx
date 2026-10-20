"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ShellRobot } from "@/lib/data/shell";
import { FilterProvider } from "./FilterContext";
import { LeftNav } from "./LeftNav";
import { ModeProvider } from "./ModeContext";
import type { Mode } from "./mode";
import { RobotSwitcher } from "./RobotSwitcher";
import { TopBar } from "./TopBar";

// The app's three columns: page navigation on the left, robot and system switcher on the
// right, search, filters and View | Edit on top. Below the wide breakpoints the side columns
// slide over the page from the top bar's buttons; on wide screens the same buttons collapse
// and reopen them (remembered per browser).
const COLLAPSE_KEY = "orbit-collapsed";
const WIDE = { left: "(min-width: 64rem)", right: "(min-width: 80rem)" } as const;
export function Shell({
  robots,
  lastRobotId,
  mode,
  member,
  children,
}: {
  robots: ShellRobot[];
  lastRobotId: string | null;
  mode: Mode;
  member: { name: string; email: string; isAdmin: boolean };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState<{ side: "left" | "right"; at: string } | null>(null);
  // A drawer closes by itself once the page changes.
  const open = drawer?.at === pathname ? drawer.side : null;
  const [collapsed, setCollapsed] = useState({ left: false, right: false });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only preference
      if (saved) setCollapsed({ left: !!saved.left, right: !!saved.right });
    } catch {}
  }, []);
  const toggle = (side: "left" | "right") => {
    if (window.matchMedia(WIDE[side]).matches) {
      const next = { ...collapsed, [side]: !collapsed[side] };
      setCollapsed(next);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {}
      return;
    }
    setDrawer(open === side ? null : { side, at: pathname });
  };

  return (
    <ModeProvider initial={mode}>
      <FilterProvider>
        <div className="flex min-h-screen">
          <aside
            className={`fixed inset-y-0 left-0 z-40 w-56 shrink-0 border-r border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${collapsed.left ? "lg:hidden" : ""} ${
              open === "left" ? "translate-x-0" : "-translate-x-full"
            } transition-transform duration-150`}
          >
            <LeftNav robots={robots} lastRobotId={lastRobotId} member={member} />
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar onMenu={() => toggle("left")} onRobots={() => toggle("right")} />
            <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
          </div>
          <aside
            className={`fixed inset-y-0 right-0 z-40 w-72 shrink-0 border-l border-line bg-surface xl:sticky xl:top-0 xl:h-screen xl:translate-x-0 ${collapsed.right ? "xl:hidden" : ""} ${
              open === "right" ? "translate-x-0" : "translate-x-full"
            } transition-transform duration-150`}
          >
            <RobotSwitcher robots={robots} lastRobotId={lastRobotId} />
          </aside>
          {open && (
            <button aria-label="Close" onClick={() => setDrawer(null)} className="fixed inset-0 z-30 bg-black/50 xl:hidden" />
          )}
        </div>
      </FilterProvider>
    </ModeProvider>
  );
}
