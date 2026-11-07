"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect, useEffectEvent, useRef, useState } from "react";
import type { ShellCategory, ShellRobot } from "@/lib/data/shell";
import { InventoryPopupProvider } from "@/components/inventory/InventoryPopup";
import { PartDetailsProvider } from "@/components/bom/PartDetailsHost";
import { Toaster } from "@/components/ui/Toaster";
import { useEscape } from "@/components/ui/useEscape";
import { ArrivalsProvider } from "./Arrivals";
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
// Side swipes on phones: how far a swipe must travel sideways (px).
const SWIPE = 50;

// Where a sideways swipe belongs to the page, not the side panels: typing, sliders, the 3D view,
// anything marked touch-none or data-no-swipe.
const OWN_SWIPE = "input, textarea, select, canvas, [role=slider], [data-no-swipe], .touch-none";

// Whether something under the touch can still scroll sideways the way the finger goes (a wide
// table, a row of cards): then the swipe scrolls it. dx > 0 is a swipe to the right.
function scrollsSideways(target: EventTarget | null, dx: number) {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    const { overflowX } = getComputedStyle(el);
    if ((overflowX !== "auto" && overflowX !== "scroll") || el.scrollWidth <= el.clientWidth + 1) continue;
    if (dx > 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
  }
  return false;
}
export function Shell({
  robots,
  lastRobotId,
  categories,
  mode,
  materialColors,
  materialsStamp,
  member,
  arrivals,
  children,
}: {
  robots: ShellRobot[];
  lastRobotId: string | null;
  categories: ShellCategory[];
  mode: Mode;
  materialColors: Record<string, string>;
  materialsStamp: number;
  member: { name: string; email: string; isAdmin: boolean };
  arrivals: { newest: Record<string, string>; seen: Record<string, string> };
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
  // The drawers and the dark backdrop, moved straight from touch events while a drawer is dragged.
  const leftAside = useRef<HTMLElement>(null);
  const rightAside = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLButtonElement>(null);
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
  // On a phone a sideways swipe anywhere opens a drawer: to the right the pages, to the left the
  // robots (Harel, 2026-11-06, was edge strips only). An open drawer follows the finger anywhere on
  // the screen: dragged toward closed it slides out, back the other way it comes back in; let go
  // past a third of its width (or flicked) it closes, else it springs back. Swipes that something
  // under the finger needs (a table scrolling sideways, a slider, typing, the 3D view) stay with it.
  useEffect(() => {
    let from: { x: number; y: number; at: number; target: EventTarget | null } | null = null;
    // While an open drawer follows the finger: how far it's out (px, toward closed) and its width.
    let drag: { offset: number; width: number; dx: number } | null = null;
    const panel = () => (open === "left" ? leftAside.current : open === "right" ? rightAside.current : null);
    const clearDrag = () => {
      for (const el of [leftAside.current, rightAside.current]) {
        if (!el) continue;
        el.style.transition = "";
        el.style.transform = "";
      }
      if (backdrop.current) backdrop.current.style.opacity = "";
    };
    clearDrag();
    const place = (offset: number, width: number) => {
      const el = panel();
      if (!el) return;
      el.style.transition = "none";
      el.style.transform = `translateX(${open === "left" ? -offset : offset}px)`;
      if (backdrop.current) backdrop.current.style.opacity = String(1 - offset / width);
    };
    const down = (e: TouchEvent) => {
      from = null;
      drag = null;
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t || document.querySelector("dialog[open]")) return;
      const el = e.target as Element | null;
      if (el?.closest?.("[role=separator]") || el?.closest?.(OWN_SWIPE)) return;
      from = { x: t.clientX, y: t.clientY, at: Date.now(), target: e.target };
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!from || !t) return;
      const dx = t.clientX - from.x;
      const dy = t.clientY - from.y;
      if (open) {
        // Starts following once the finger goes more sideways than up or down.
        if (!drag) {
          if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) return void (from = null);
          if (Math.abs(dx) < 10) return;
          const el = panel();
          if (!el) return void (from = null);
          drag = { offset: 0, width: el.offsetWidth, dx: 0 };
        }
        const toward = open === "left" ? -dx : dx;
        drag.offset = Math.min(Math.max(toward, 0), drag.width);
        drag.dx = dx;
        place(drag.offset, drag.width);
        return;
      }
      // Mostly up or down: a scroll, not a swipe.
      if (Math.abs(dy) > 30 && Math.abs(dy) > Math.abs(dx)) {
        from = null;
        return;
      }
      if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (!scrollsSideways(from.target, dx)) {
        if (dx > 0 && !wide.left) setDrawer({ side: "left", at: pathname });
        else if (dx < 0 && !wide.right) setDrawer({ side: "right", at: pathname });
      }
      from = null;
    };
    const up = () => {
      const el = panel();
      if (drag && from && el) {
        const { offset, width } = drag;
        const fast = offset > 20 && offset / Math.max(Date.now() - from.at, 1) > 0.5;
        const close = offset > width / 3 || fast;
        // Glides the rest of the way, then hands back to the classes (closed or open).
        el.style.transition = "transform 150ms ease-out";
        el.style.transform = close ? (open === "left" ? "translateX(-100%)" : "translateX(100%)") : "translateX(0)";
        if (backdrop.current) backdrop.current.style.opacity = close ? "0" : "1";
        // Closed: the classes take over once the drawer has rendered closed (the effect's start
        // clears these); sprung back open, the classes already say open.
        setTimeout(() => (close ? setDrawer(null) : clearDrag()), 160);
      }
      from = null;
      drag = null;
    };
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
  // Esc with nothing else to close collapses the side columns: the robots first, then the pages
  // (Harel, 2026-11-07). It waits until the key has gone everywhere, so a window, popover, mode or
  // field that used it (preventDefault) keeps it. Drawers close through useEscape above.
  const escCollapse = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || open) return;
    const side = wide.right && !collapsed.right ? "right" : wide.left && !collapsed.left ? "left" : null;
    if (side) toggle(side);
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
      // Checked now, not after: a window closes itself on this same Esc.
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      setTimeout(() => escCollapse(e));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ArrivalsProvider newest={arrivals.newest} seen={arrivals.seen}>
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
                  ref={leftAside}
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
                  ref={rightAside}
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
                {/* With a mouse, a hidden column also opens from the screen's edge: the strip past the
                    page's padding turns blue under the pointer and a click opens it (Harel, 2026-11-07).
                    Narrower than the page's padding, so it never covers a card. */}
                {!open &&
                  (["left", "right"] as const).map(
                    (side) =>
                      (!wide[side] || collapsed[side]) && (
                        <button
                          key={side}
                          type="button"
                          tabIndex={-1}
                          aria-hidden
                          title={side === "left" ? "Open the pages" : "Open the robots"}
                          onClick={() => toggle(side)}
                          className={`fixed inset-y-0 z-30 hidden w-3 transition-colors duration-150 hover:bg-accent/40 pointer-fine:block ${side === "left" ? "left-0" : "right-0"}`}
                        />
                      ),
                  )}
                {open && (
                  <button ref={backdrop} aria-label="Close" onClick={() => setDrawer(null)} className="fixed inset-0 z-30 bg-black/50 xl:hidden" />
                )}
              </div>
            </PartDetailsProvider>
            <Toaster />
          </InventoryPopupProvider>
        </MaterialColorsProvider>
      </FilterProvider>
    </ModeProvider>
    </ArrivalsProvider>
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
