"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import type { ShellCategory, ShellRobot } from "@/lib/data/shell";
import { InventoryPopupProvider } from "@/components/inventory/InventoryPopup";
import { PartDetailsProvider } from "@/components/bom/PartDetailsHost";
import { Toaster } from "@/components/ui/Toaster";
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
// slide over the page from the top bar's ☰ and robots buttons; on wide screens the same two
// buttons collapse and reopen them (remembered per browser). --shell-left and --shell-right hold
// the columns' current widths, for overlays that cover only the page.
const COLLAPSE_KEY = "orbit-collapsed";
// The pages column can be dragged wider: first it shows the names it cuts off, past that its
// text grows. Dragged narrower it cuts the names short, then keeps only the icons (Harel,
// 2026-11-04). nav = { w: width in px, z: text zoom }, remembered per browser.
const NAV_KEY = "orbit-nav-width";
const NAV_DEFAULT = 224;
// The round logo and the icons, nothing cut.
const NAV_SMALLEST = 60;
// The robots column drags too, from its inner edge: wider, its cards and text grow with it;
// narrower, down to ROBOTS_SMALLEST (Harel, 2026-11-04). Same { w, z } shape, remembered per browser.
const ROBOTS_KEY = "orbit-robots-width";
const ROBOTS_DEFAULT = 288;
const ROBOTS_SMALLEST = 200;
const WIDE = { left: "(min-width: 64rem)", right: "(min-width: 80rem)" } as const;
// Edge swipes on phones: how close to the edge a touch must start, and how far it must travel (px).
const EDGE = 32;
const SWIPE = 50;
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
  const [nav, setNav] = useState({ w: NAV_DEFAULT, z: 1 });
  const [robotsCol, setRobotsCol] = useState({ w: ROBOTS_DEFAULT, z: 1 });
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
  // On a phone a swipe in from the screen's edge opens that side's drawer, and a swipe back the way
  // it came closes it (Harel, 2026-11-04). Only touches that start in the edge strip open one, so
  // tables and pictures that scroll sideways keep their swipes. In Safari's tab (not from the home
  // screen) iOS keeps the left edge's first ~20px for Back, so the strip is a little wider than that.
  useEffect(() => {
    let from: { x: number; y: number; side: "left" | "right" | null } | null = null;
    const down = (e: TouchEvent) => {
      from = null;
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t || document.querySelector("dialog[open]")) return;
      if ((e.target as Element | null)?.closest?.("[role=separator]")) return;
      if (open) from = { x: t.clientX, y: t.clientY, side: null };
      else if (!wide.left && t.clientX <= EDGE) from = { x: t.clientX, y: t.clientY, side: "left" };
      else if (!wide.right && t.clientX >= window.innerWidth - EDGE) from = { x: t.clientX, y: t.clientY, side: "right" };
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!from || !t) return;
      const dx = t.clientX - from.x;
      const dy = t.clientY - from.y;
      // Mostly up or down: a scroll, not a swipe.
      if (Math.abs(dy) > 30 && Math.abs(dy) > Math.abs(dx)) {
        from = null;
        return;
      }
      if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (from.side === "left" && dx > 0) setDrawer({ side: "left", at: pathname });
      else if (from.side === "right" && dx < 0) setDrawer({ side: "right", at: pathname });
      else if (!from.side && ((open === "left" && dx < 0) || (open === "right" && dx > 0))) setDrawer(null);
      from = null;
    };
    const up = () => (from = null);
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [open, wide, pathname]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only preference
      if (saved) setCollapsed({ left: !!saved.left, right: !!saved.right });
      const width = JSON.parse(localStorage.getItem(NAV_KEY) ?? "null");
      if (width?.w >= NAV_SMALLEST) setNav({ w: width.w, z: Math.max(1, width.z || 1) });
      const robotsWidth = JSON.parse(localStorage.getItem(ROBOTS_KEY) ?? "null");
      if (robotsWidth?.w >= ROBOTS_SMALLEST) setRobotsCol({ w: robotsWidth.w, z: Math.max(1, robotsWidth.z || 1) });
    } catch {}
  }, []);
  const saveNav = (next: { w: number; z: number }) => {
    setNav(next);
    try {
      localStorage.setItem(NAV_KEY, JSON.stringify(next));
    } catch {}
  };
  const saveSide = (next: { w: number; z: number }) => {
    setRobotsCol(next);
    try {
      localStorage.setItem(ROBOTS_KEY, JSON.stringify(next));
    } catch {}
  };
  const toggle = (side: "left" | "right") => {
    if (window.matchMedia(WIDE[side]).matches) {
      // From the latest state, so two quick presses each count.
      setCollapsed((prev) => {
        const next = { ...prev, [side]: !prev[side] };
        try {
          localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
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
                style={{ "--nav-w": `${nav.w}px`, "--nav-zoom": nav.z, "--robots-w": `${robotsCol.w}px`, "--robots-zoom": robotsCol.z } as React.CSSProperties}
                className={`flex min-h-dvh max-w-full overflow-x-clip [--shell-left:0px] [--shell-right:0px] ${collapsed.left ? "" : "lg:[--shell-left:var(--nav-w)]"} ${collapsed.right ? "" : "xl:[--shell-right:var(--robots-w)]"}`}
              >
                <aside
                  inert={!wide.left && open !== "left"}
                  className={`@container fixed inset-y-0 left-0 z-40 w-[var(--nav-w)] max-w-[calc(100vw-3rem)] shrink-0 bg-surface lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${collapsed.left ? "lg:hidden" : ""} ${
                    open === "left" ? "translate-x-0" : "-translate-x-full"
                  } transition-transform duration-150`}
                >
                  <LeftNav robots={robots} lastRobotId={lastRobotId} categories={categories} member={member} />
                  <NavResizer root={root} nav={nav} onDone={saveNav} />
                </aside>
                <div className="flex min-w-0 flex-1 flex-col">
                  <TopBar onMenu={() => toggle("left")} onRobots={() => toggle("right")} navHidden={collapsed.left} robotsHidden={collapsed.right} />
                <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
                  <Suspense>
                    <VisitTracker />
                  </Suspense>
                  <Shortcuts robots={robots} lastRobotId={lastRobotId} />
                </div>
                <aside
                  inert={!wide.right && open !== "right"}
                  className={`fixed inset-y-0 right-0 z-40 w-[var(--robots-w)] max-w-[calc(100vw-3rem)] shrink-0 border-l border-line bg-surface xl:sticky xl:top-0 xl:h-dvh xl:translate-x-0 ${collapsed.right ? "xl:hidden" : ""} ${
                    open === "right" ? "translate-x-0" : "translate-x-full"
                  } transition-transform duration-150`}
                >
                  <div className="h-full" style={{ zoom: "var(--robots-zoom, 1)" }}>
                    <RobotSwitcher robots={robots} lastRobotId={lastRobotId} isAdmin={member.isAdmin} />
                  </div>
                  <RobotsResizer root={root} side={robotsCol} onDone={saveSide} />
                </aside>
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

// The drag strip on the pages column's right edge. While dragging it writes the CSS variables
// straight onto the shell (no React render per frame) and saves the result on release. Up to the
// width where nothing is cut off the column only widens; past it the text zooms with the width,
// so the names keep filling the column. Narrower than normal, LeftNav cuts names short and then
// shows only icons. Double-click goes back to the normal width.
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
    // The width the pages need with nothing cut off, measured with the folders open right now. The
    // column is made wide for the measurement, so names it hides when narrow are counted too.
    const aside = handle.parentElement!;
    const zoom = body.style.zoom;
    body.style.zoom = "1";
    body.style.width = "max-content";
    aside.style.width = "100vw";
    const fit = Math.max(NAV_DEFAULT, Math.ceil(body.getBoundingClientRect().width) + 2);
    body.style.zoom = zoom;
    body.style.width = "";
    aside.style.width = "";
    // Half the screen as a column; as a drawer, the aside's own cap (3rem of page left showing).
    const room = window.matchMedia(WIDE.left).matches ? window.innerWidth / 2 : window.innerWidth - 48;
    const max = Math.max(NAV_DEFAULT, Math.min(room, fit * 1.8));
    const x0 = e.clientX;
    let next = nav;
    let frame = 0;
    const move = (ev: PointerEvent) => {
      const w = Math.round(Math.min(max, Math.max(NAV_SMALLEST, nav.w + ev.clientX - x0)));
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
      aria-label="Drag to resize the pages"
      title="Drag to resize, double-click to reset"
      onPointerDown={start}
      onDoubleClick={() => onDone({ w: NAV_DEFAULT, z: 1 })}
      className="group absolute inset-y-0 -right-1.5 z-10 w-3 cursor-col-resize touch-none pointer-coarse:-right-3 pointer-coarse:w-6"
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-accent opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-active:opacity-100" />
    </div>
  );
}

// The drag strip on the robots column's inner (left) edge, like the pages column's: it writes the
// CSS variables straight onto the shell while dragging and saves on release. Wider than normal the
// column's content zooms with it, narrower it only narrows. Double-click goes back to normal.
function RobotsResizer({
  root,
  side,
  onDone,
}: {
  root: React.RefObject<HTMLDivElement | null>;
  side: { w: number; z: number };
  onDone: (side: { w: number; z: number }) => void;
}) {
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    const shell = root.current;
    if (!shell || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    // Half the screen as a column; as a drawer, the aside's own cap (3rem of page left showing).
    const room = window.matchMedia(WIDE.right).matches ? window.innerWidth / 2 : window.innerWidth - 48;
    const max = Math.max(ROBOTS_DEFAULT, Math.min(room, ROBOTS_DEFAULT * 1.8));
    const x0 = e.clientX;
    let next = side;
    let frame = 0;
    const move = (ev: PointerEvent) => {
      // The column grows leftwards: dragging left widens it.
      const w = Math.round(Math.min(max, Math.max(ROBOTS_SMALLEST, side.w + x0 - ev.clientX)));
      next = { w, z: w > ROBOTS_DEFAULT ? w / ROBOTS_DEFAULT : 1 };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        shell.style.setProperty("--robots-w", `${next.w}px`);
        shell.style.setProperty("--robots-zoom", String(next.z));
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
      aria-label="Drag to resize the robots"
      title="Drag to resize, double-click to reset"
      onPointerDown={start}
      onDoubleClick={() => onDone({ w: ROBOTS_DEFAULT, z: 1 })}
      className="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none pointer-coarse:-left-3 pointer-coarse:w-6"
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-accent opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-active:opacity-100" />
    </div>
  );
}
