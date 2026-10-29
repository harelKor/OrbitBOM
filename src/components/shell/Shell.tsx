"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { MaterialList } from "@/config/materials";
import type { ShellCategory, ShellRobot } from "@/lib/data/shell";
import { InventoryPopupProvider } from "@/components/inventory/InventoryPopup";
import { PartDetailsProvider } from "@/components/bom/PartDetailsHost";
import { Toaster } from "@/components/ui/Toaster";
import { Icon } from "@/components/ui/Icon";
import { FilterProvider } from "./FilterContext";
import { LeftNav } from "./LeftNav";
import { MaterialColorsProvider } from "./MaterialColors";
import { ModeProvider } from "./ModeContext";
import type { Mode } from "./mode";
import { RobotSwitcher } from "./RobotSwitcher";
import { Shortcuts } from "./Shortcuts";
import { TopBar } from "./TopBar";
import { VisitTracker } from "./VisitTracker";

// The app's three columns: page navigation on the left, robot and system switcher on the
// right, search, filters and View | Edit on top. Below the wide breakpoints the side columns
// slide over the page from the top bar's buttons; on wide screens an arrow on each column's
// inner edge collapses and reopens it (remembered per browser). --shell-left and
// --shell-right hold the columns' current widths, for overlays that cover only the page.
const COLLAPSE_KEY = "orbit-collapsed";
const WIDE = { left: "(min-width: 64rem)", right: "(min-width: 80rem)" } as const;
export function Shell({
  robots,
  lastRobotId,
  categories,
  mode,
  editing,
  materialColors,
  materials,
  member,
  children,
}: {
  robots: ShellRobot[];
  lastRobotId: string | null;
  categories: ShellCategory[];
  mode: Mode;
  editing: boolean;
  materialColors: Record<string, string>;
  materials: MaterialList;
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
    <ModeProvider initial={mode} editing={editing} isAdmin={member.isAdmin}>
      <FilterProvider>
        <MaterialColorsProvider initial={materialColors} materials={materials}>
          <InventoryPopupProvider>
            <PartDetailsProvider>
              <div
                className={`flex min-h-dvh [--shell-left:0px] [--shell-right:0px] ${collapsed.left ? "" : "lg:[--shell-left:14rem]"} ${collapsed.right ? "" : "xl:[--shell-right:18rem]"}`}
              >
                <aside
                  className={`fixed inset-y-0 left-0 z-40 w-56 shrink-0 bg-surface lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${collapsed.left ? "lg:hidden" : ""} ${
                    open === "left" ? "translate-x-0" : "-translate-x-full"
                  } transition-transform duration-150`}
                >
                  <LeftNav robots={robots} lastRobotId={lastRobotId} categories={categories} member={member} />
                </aside>
                <div className="flex min-w-0 flex-1 flex-col">
                  <TopBar onMenu={() => toggle("left")} onRobots={() => toggle("right")} navHidden={collapsed.left} />
                  {/* The wide side gutters keep the collapse arrows clear of the page. */}
                <main className="min-w-0 flex-1 p-4 md:p-6 lg:pl-11 xl:pr-11">{children}</main>
                  <Suspense>
                    <VisitTracker />
                  </Suspense>
                  <Shortcuts robots={robots} lastRobotId={lastRobotId} />
                </div>
                <aside
                  className={`fixed inset-y-0 right-0 z-40 w-72 shrink-0 border-l border-line bg-surface xl:sticky xl:top-0 xl:h-dvh xl:translate-x-0 ${collapsed.right ? "xl:hidden" : ""} ${
                    open === "right" ? "translate-x-0" : "translate-x-full"
                  } transition-transform duration-150`}
                >
                  <RobotSwitcher robots={robots} lastRobotId={lastRobotId} isAdmin={member.isAdmin} />
                </aside>
                <EdgeArrow side="left" collapsed={collapsed.left} onClick={() => toggle("left")} />
                <EdgeArrow side="right" collapsed={collapsed.right} onClick={() => toggle("right")} />
                {open && (
                  <button aria-label="Close" onClick={() => setDrawer(null)} className="fixed inset-0 z-30 bg-black/50 xl:hidden" />
                )}
              </div>
            </PartDetailsProvider>
            <Toaster />
          </InventoryPopupProvider>
        </MaterialColorsProvider>
      </FilterProvider>
    </ModeProvider>
  );
}

// The wide-screen collapse handle: a bright accent tab with a big arrow on the column's inner
// edge, at the middle of the screen. It sits in the page's side gutter (main pads for it), so it
// never covers content. It points the way the column will move. On touch screens (tablets, a
// phone showing the desktop site) it shrinks to a slim, see-through tab.
function EdgeArrow({ side, collapsed, onClick }: { side: "left" | "right"; collapsed: boolean; onClick: () => void }) {
  const pointsLeft = side === "left" ? !collapsed : collapsed;
  return (
    <button
      onClick={onClick}
      aria-label={`${collapsed ? "Show" : "Hide"} ${side === "left" ? "pages" : "robots and systems"}`}
      title={`${collapsed ? "Show" : "Hide"} ${side === "left" ? "pages" : "robots and systems"}`}
      className={`press fixed top-1/2 z-50 hidden h-20 w-7 -translate-y-1/2 items-center justify-center bg-accent text-white shadow-[0_6px_18px_-4px_var(--color-accent)] hover:bg-accent-hover pointer-coarse:h-12 pointer-coarse:w-4 pointer-coarse:bg-accent/45 pointer-coarse:shadow-none ${
        side === "left"
          ? "left-[calc(var(--shell-left)-1px)] rounded-r-xl lg:flex"
          : "right-[calc(var(--shell-right)-1px)] rounded-l-xl xl:flex"
      }`}
    >
      <Icon name="chevron" className={`h-6 w-6 stroke-[2.5] pointer-coarse:h-3.5 pointer-coarse:w-3.5 transition-transform duration-150 ${pointsLeft ? "rotate-180" : ""}`} />
    </button>
  );
}
