"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ShellRobot } from "@/lib/data/shell";
import { FilterProvider } from "./FilterContext";
import { LeftNav } from "./LeftNav";
import { ModeProvider } from "./ModeContext";
import type { Mode } from "./mode";
import { RobotSwitcher } from "./RobotSwitcher";
import { TopBar } from "./TopBar";

// The app's three columns: page navigation on the left, robot and system switcher on the
// right, search, filters and View | Edit on top. Below the wide breakpoints the side columns
// slide over the page from the top bar's buttons.
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
  const toggle = (side: "left" | "right") => setDrawer(open === side ? null : { side, at: pathname });

  return (
    <ModeProvider initial={mode}>
      <FilterProvider>
        <div className="flex min-h-screen">
          <aside
            className={`fixed inset-y-0 left-0 z-40 w-56 shrink-0 border-r border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
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
            className={`fixed inset-y-0 right-0 z-40 w-72 shrink-0 border-l border-line bg-surface xl:sticky xl:top-0 xl:h-screen xl:translate-x-0 ${
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
