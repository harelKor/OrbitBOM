"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import type { ShellCategory, ShellRobot } from "@/lib/data/shell";
import { InventoryPopupProvider } from "@/components/inventory/InventoryPopup";
import { PartDetailsProvider } from "@/components/bom/PartDetailsHost";
import { Toaster } from "@/components/ui/Toaster";
import { Icon } from "@/components/ui/Icon";
import { useEscape } from "@/components/ui/useEscape";
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
// slide over the page from the top bar's buttons; on wide screens an arrow on the left column's
// inner edge and a button at the top bar's right end collapse and reopen them (remembered per
// browser). --shell-left and --shell-right hold the columns' current widths, for overlays that
// cover only the page.
const COLLAPSE_KEY = "orbit-collapsed";
// The pages column can be dragged wider: first it shows the names it cuts off, past that its
// text grows (Harel, 2026-11-04). nav = { w: width in px, z: text zoom }, remembered per browser.
const NAV_KEY = "orbit-nav-width";
const NAV_MIN = 224;
const WIDE = { left: "(min-width: 64rem)", right: "(min-width: 80rem)" } as const;
export function Shell({
  robots,
  lastRobotId,
  categories,
  mode,
  materialColors,
  materialsStamp,
  member,
  children,
}: {
  robots: ShellRobot[];
  lastRobotId: string | null;
  categories: ShellCategory[];
  mode: Mode;
  materialColors: Record<string, string>;
  materialsStamp: number;
  member: { name: string; email: string; isAdmin: boolean };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState<{ side: "left" | "right"; at: string } | null>(null);
  // A drawer closes by itself once the page changes.
  const open = drawer?.at === pathname ? drawer.side : null;
  const [collapsed, setCollapsed] = useState({ left: false, right: false });
  const [nav, setNav] = useState({ w: NAV_MIN, z: 1 });
  const root = useRef<HTMLDivElement>(null);
  // Which columns are on screen as columns (not drawers). A drawer that's slid away is inert, so
  // Tab and screen readers skip its links; Escape closes an open one.
  const [wide, setWide] = useState({ left: true, right: true });
  useEffect(() => {
    const lists = { left: matchMedia(WIDE.left), right: matchMedia(WIDE.right) };
    const sync = () => setWide({ left: lists.left.matches, right: lists.right.matches });
    sync();
    lists.left.addEventListener("change", sync);
    lists.right.addEventListener("change", sync);
    return () => {
      lists.left.removeEventListener("change", sync);
      lists.right.removeEventListener("change", sync);
    };
  }, []);
  useEscape(!!open, () => setDrawer(null));
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only preference
      if (saved) setCollapsed({ left: !!saved.left, right: !!saved.right });
      const width = JSON.parse(localStorage.getItem(NAV_KEY) ?? "null");
      if (width?.w >= NAV_MIN) setNav({ w: width.w, z: Math.max(1, width.z || 1) });
    } catch {}
  }, []);
  const saveNav = (next: { w: number; z: number }) => {
    setNav(next);
    try {
      localStorage.setItem(NAV_KEY, JSON.stringify(next));
    } catch {}
  };
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
    <ModeProvider initial={mode} isAdmin={member.isAdmin}>
      <FilterProvider>
        <MaterialColorsProvider initial={materialColors} stamp={materialsStamp}>
          <InventoryPopupProvider>
            <PartDetailsProvider>
              <div
                ref={root}
                style={{ "--nav-w": `${nav.w}px`, "--nav-zoom": nav.z } as React.CSSProperties}
                className={`flex min-h-dvh max-w-full overflow-x-clip [--shell-left:0px] [--shell-right:0px] ${collapsed.left ? "" : "lg:[--shell-left:var(--nav-w)]"} ${collapsed.right ? "" : "xl:[--shell-right:18rem]"}`}
              >
                <aside
                  inert={!wide.left && open !== "left"}
                  className={`fixed inset-y-0 left-0 z-40 w-[var(--nav-w)] max-w-[calc(100vw-3rem)] shrink-0 bg-surface lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${collapsed.left ? "lg:hidden" : ""} ${
                    open === "left" ? "translate-x-0" : "-translate-x-full"
                  } transition-transform duration-150`}
                >
                  <LeftNav robots={robots} lastRobotId={lastRobotId} categories={categories} member={member} />
                  <NavResizer root={root} nav={nav} onDone={saveNav} />
                </aside>
                <div className="flex min-w-0 flex-1 flex-col">
                  <TopBar onMenu={() => toggle("left")} onRobots={() => toggle("right")} navHidden={collapsed.left} robotsHidden={collapsed.right} />
                  {/* The wide left gutter keeps the collapse arrow clear of the page. */}
                <main className="min-w-0 flex-1 p-4 md:p-6 lg:pl-11">{children}</main>
                  <Suspense>
                    <VisitTracker />
                  </Suspense>
                  <Shortcuts robots={robots} lastRobotId={lastRobotId} />
                </div>
                <aside
                  inert={!wide.right && open !== "right"}
                  className={`fixed inset-y-0 right-0 z-40 w-72 shrink-0 border-l border-line bg-surface xl:sticky xl:top-0 xl:h-dvh xl:translate-x-0 ${collapsed.right ? "xl:hidden" : ""} ${
                    open === "right" ? "translate-x-0" : "translate-x-full"
                  } transition-transform duration-150`}
                >
                  <RobotSwitcher robots={robots} lastRobotId={lastRobotId} isAdmin={member.isAdmin} />
                </aside>
                <EdgeArrow collapsed={collapsed.left} onClick={() => toggle("left")} />
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

// The wide-screen collapse handle: a slim bright accent tab with an arrow on the pages column's
// inner edge, at the middle of the screen. It sits in the page's left gutter (main pads for it),
// so it never covers content. It points the way the column will move. On touch screens (tablets,
// a phone showing the desktop site) it shrinks to a slim, see-through tab.
function EdgeArrow({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const label = `${collapsed ? "Show" : "Hide"} pages`;
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="press fixed top-1/2 left-[calc(var(--shell-left)-1px)] z-50 hidden h-14 w-5 -translate-y-1/2 items-center justify-center rounded-r-xl border border-white/20 bg-bar text-white shadow-[0_0_18px_rgba(0,24,230,0.65)] transition-[filter,box-shadow] duration-150 hover:brightness-125 hover:shadow-[0_0_24px_rgba(0,34,255,0.8)] pointer-coarse:h-10 pointer-coarse:w-3.5 pointer-coarse:bg-bar/60 pointer-coarse:shadow-none lg:flex"
    >
      <Icon name="chevron" className={`h-4 w-4 stroke-[2.5] pointer-coarse:h-3 pointer-coarse:w-3 transition-transform duration-150 ${collapsed ? "" : "rotate-180"}`} />
    </button>
  );
}

// The drag strip on the pages column's right edge. While dragging it writes the CSS variables
// straight onto the shell (no React render per frame) and saves the result on release. Up to the
// width where nothing is cut off the column only widens; past it the text zooms with the width,
// so the names keep filling the column. Double-click goes back to the normal width.
function NavResizer({
  root,
  nav,
  onDone,
}: {
  root: React.RefObject<HTMLDivElement | null>;
  nav: { w: number; z: number };
  onDone: (nav: { w: number; z: number }) => void;
}) {
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    const shell = root.current;
    const body = shell?.querySelector<HTMLElement>("[data-nav-body]");
    if (!shell || !body || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    // The width the pages need with nothing cut off, measured with the folders open right now.
    const zoom = body.style.zoom;
    body.style.zoom = "1";
    body.style.width = "max-content";
    const fit = Math.max(NAV_MIN, Math.ceil(body.getBoundingClientRect().width) + 2);
    body.style.zoom = zoom;
    body.style.width = "";
    // Half the screen as a column; as a drawer, the aside's own cap (3rem of page left showing).
    const room = window.matchMedia(WIDE.left).matches ? window.innerWidth / 2 : window.innerWidth - 48;
    const max = Math.max(NAV_MIN, Math.min(room, fit * 1.8));
    const x0 = e.clientX;
    let next = nav;
    let frame = 0;
    const move = (ev: PointerEvent) => {
      const w = Math.round(Math.min(max, Math.max(NAV_MIN, nav.w + ev.clientX - x0)));
      next = { w, z: w > fit ? w / fit : 1 };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        shell.style.setProperty("--nav-w", `${next.w}px`);
        shell.style.setProperty("--nav-zoom", String(next.z));
      });
    };
    const end = () => {
      cancelAnimationFrame(frame);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.classList.remove("select-none", "cursor-col-resize");
      onDone(next);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    document.body.classList.add("select-none", "cursor-col-resize");
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Drag to widen the pages"
      title="Drag to widen, double-click to reset"
      onPointerDown={start}
      onDoubleClick={() => onDone({ w: NAV_MIN, z: 1 })}
      className="group absolute inset-y-0 -right-1.5 z-10 w-3 cursor-col-resize touch-none pointer-coarse:-right-3 pointer-coarse:w-6"
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-accent opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-active:opacity-100" />
    </div>
  );
}
