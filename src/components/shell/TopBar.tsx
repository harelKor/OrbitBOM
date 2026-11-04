"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useFilters } from "./FilterContext";
import { Icon } from "@/components/ui/Icon";
import { Brand } from "./Brand";
import { ModeToggle } from "./ModeContext";
import { UndoRedo } from "./UndoRedo";

// The two panel buttons (pages on the left, robots on the right) match the Undo/Redo squares.
// 36px on touch screens: the bar's menus are tapped all day in the shop. No display class here, so
// each button says when it shows.
const square = "press h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/30 hover:bg-white/10 pointer-coarse:h-9 pointer-coarse:w-9";

export function TopBar({ onMenu, onRobots, navHidden, robotsHidden }: { onMenu: () => void; onRobots: () => void; navHidden: boolean; robotsHidden: boolean }) {
  const pathname = usePathname();
  const { filters, setFilters } = useFilters();
  const search = useRef<HTMLInputElement>(null);
  const header = useRef<HTMLElement>(null);
  // Part search applies to the robot pages; Inventory has its own.
  const partPages = pathname.startsWith("/robots/") && pathname !== "/robots/new";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // The bar wraps to more rows on narrow screens; --topbar-h lets sticky strips sit right under it.
  useEffect(() => {
    const el = header.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header ref={header} className="sticky top-0 z-20 flex min-h-11 flex-wrap items-center gap-1.5 bg-bar px-3 py-1 sm:gap-2 sm:px-4 text-white shadow-[0_2px_8px_rgba(0,0,120,0.25)] md:px-6">
      <button onClick={onMenu} className={`${square} flex lg:hidden`} aria-label="Pages" title="Show pages">
        ☰
      </button>
      {/* The mark stays on screen whenever the left panel isn't showing it. */}
      <div className={navHidden ? "" : "lg:hidden"}>
        <Brand compact />
      </div>
      {partPages && (
        <>
          {/* On phones the search takes its own row under the buttons, so the buttons fit one row. */}
          <div className={`relative min-w-40 flex-1 max-sm:order-last max-sm:basis-full md:max-w-sm ${navHidden ? "" : "lg:ml-24"}`}>
            <input
              ref={search}
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              placeholder="Search part name"
              className={`input border-white bg-white text-[#111318] ${filters.q ? "pr-9 sm:pr-[5.5rem]" : "sm:pr-16"}`}
            />
            {/* Right edge of the box: the shortcut hint, then the clear button in the far corner. */}
            <div className="absolute inset-y-0 right-1.5 flex items-center gap-1.5">
              <kbd className="pointer-events-none rounded max-sm:hidden border border-line-strong px-1.5 text-[11px] text-subtle">Ctrl K</kbd>
              {filters.q && (
                <button
                  type="button"
                  onClick={() => {
                    setFilters({ q: "" });
                    search.current?.focus();
                  }}
                  aria-label="Clear search"
                  title="Clear search"
                  className="press flex h-6 w-6 items-center justify-center rounded-md border border-line-strong bg-raised text-muted pointer-coarse:h-8 pointer-coarse:w-8 hover:border-accent hover:bg-accent hover:text-white active:scale-[0.98]"
                >
                  <Icon name="close" className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </>
      )}
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <UndoRedo />
        <ModeToggle />
        {/* Not a second ☰: this one opens the robots and systems, the left one the pages. */}
        <button onClick={onRobots} className={`${square} flex xl:hidden`} aria-label="Robots and systems" title="Show robots and systems">
          <Icon name="layers" className="h-5 w-5" />
        </button>
        {/* Wide screens: collapses and reopens the robots column. It lives in the bar's corner so
            the page needs no right gutter for it (Harel, 2026-11-04). Points the way the column moves. */}
        <button
          onClick={onRobots}
          className={`${square} hidden xl:flex`}
          aria-label={`${robotsHidden ? "Show" : "Hide"} robots and systems`}
          title={`${robotsHidden ? "Show" : "Hide"} robots and systems`}
        >
          <Icon name="chevron" className={`h-4 w-4 stroke-[2.5] transition-transform duration-150 ${robotsHidden ? "rotate-180" : ""}`} />
        </button>
      </div>
    </header>
  );
}

