"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useFilters } from "./FilterContext";
import { Icon } from "@/components/ui/Icon";
import { Brand } from "./Brand";
import { ModeToggle } from "./ModeContext";
import { UndoRedo } from "./UndoRedo";

// The two panel buttons (pages on the left, robots on the right) match the Undo/Redo squares.
const square = "press flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/30 hover:bg-white/10";

export function TopBar({ onMenu, onRobots, navHidden }: { onMenu: () => void; onRobots: () => void; navHidden: boolean }) {
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
    <header ref={header} className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-1.5 bg-bar px-3 py-2.5 sm:gap-2 sm:px-4 text-white shadow-[0_2px_8px_rgba(0,0,120,0.25)] md:px-6">
      <button onClick={onMenu} className={`${square} lg:hidden`} aria-label="Pages" title="Show pages">
        ☰
      </button>
      {/* The mark stays on screen whenever the left panel isn't showing it. */}
      <div className={navHidden ? "" : "lg:hidden"}>
        <Brand compact />
      </div>
      {partPages && (
        <>
          {/* On phones the search takes its own row under the buttons, so the buttons fit one row. */}
          <div className="relative min-w-40 flex-1 max-sm:order-last max-sm:basis-full md:max-w-sm">
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
                  className="press flex h-6 w-6 items-center justify-center rounded-md border border-line-strong bg-raised text-muted hover:border-accent hover:bg-accent hover:text-white active:scale-[0.98]"
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
        <button onClick={onRobots} className={`${square} xl:hidden`} aria-label="Robots and systems" title="Show robots and systems">
          ☰
        </button>
      </div>
    </header>
  );
}

