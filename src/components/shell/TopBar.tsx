"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { getMachine, MACHINES } from "@/config/machines";
import { MATERIAL_OPTIONS } from "@/components/bom/options";
import { OptionList, Popover, type Option } from "@/components/bom/Popover";
import { DATE_OPTIONS, useFilters, type DateFilter, type Filters } from "./FilterContext";
import { Brand } from "./Brand";
import { ModeToggle } from "./ModeContext";
import { UndoRedo } from "./UndoRedo";

const PROCESS_OPTIONS: Option[] = [{ value: null, label: "Any process" }, ...MACHINES.map((m) => ({ value: m.id, label: m.name }))];
const DATE_PICK: Option[] = [{ value: null, label: "Any time" }, ...DATE_OPTIONS.map((d) => ({ value: d.value, label: d.label }))];
const MATERIAL_PICK: Option[] = [{ value: null, label: "Any material" }, ...MATERIAL_OPTIONS.filter((o) => o.value)];

export function TopBar({ onMenu, onRobots, navHidden }: { onMenu: () => void; onRobots: () => void; navHidden: boolean }) {
  const pathname = usePathname();
  const { filters, setFilters } = useFilters();
  const search = useRef<HTMLInputElement>(null);
  const header = useRef<HTMLElement>(null);
  // Part search and filters apply to the robot pages; Inventory has its own.
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

  const active = filters.q || filters.material || filters.process || filters.date;

  return (
    <header ref={header} className="sticky top-0 z-20 flex min-h-14 flex-wrap items-center gap-2 bg-bar px-4 py-2.5 text-white shadow-[0_2px_8px_rgba(0,0,120,0.25)] md:px-6">
      <button onClick={onMenu} className="press rounded-md border border-white/30 px-2 py-1 lg:hidden" aria-label="Pages" title="Show pages">
        ☰
      </button>
      {/* The mark stays on screen whenever the left panel isn't showing it. */}
      <div className={navHidden ? "" : "lg:hidden"}>
        <Brand compact />
      </div>
      {partPages && (
        <>
          <div className="relative min-w-40 flex-1 md:max-w-sm">
            <input
              ref={search}
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              placeholder="Search part name"
              className={`input border-white bg-white text-[#111318] ${filters.q ? "pr-20" : "pr-14"}`}
            />
            {filters.q && (
              <button
                type="button"
                onClick={() => {
                  setFilters({ q: "" });
                  search.current?.focus();
                }}
                aria-label="Clear search"
                title="Clear search"
                className="press absolute top-1/2 right-14 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-subtle hover:bg-line hover:text-[#111318]"
              >
                ✕
              </button>
            )}
            <kbd className="absolute top-1.5 right-2 rounded border border-line-strong px-1.5 text-[11px] text-subtle">Ctrl K</kbd>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill label="Material" value={filters.material || null} options={MATERIAL_PICK} pick={(v) => setFilters({ material: v ?? "" })} />
            <Pill
              label="Process"
              value={filters.process || null}
              shown={filters.process ? getMachine(filters.process)?.name : undefined}
              options={PROCESS_OPTIONS}
              pick={(v) => setFilters({ process: v ?? "" })}
            />
            <Pill
              label="Date"
              value={filters.date || null}
              shown={DATE_OPTIONS.find((d) => d.value === filters.date)?.label}
              options={DATE_PICK}
              pick={(v) => setFilters({ date: (v ?? "") as DateFilter })}
            />
            {active && (
              <button
                onClick={() => setFilters({ q: "", material: "", process: "", date: "" } satisfies Filters)}
                className="press px-1.5 text-xs text-white/80 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
        </>
      )}
      <div className="ml-auto flex items-center gap-2">
        <UndoRedo />
        <ModeToggle />
        <button onClick={onRobots} className="press rounded-md border border-white/30 px-2 py-1 text-xs font-semibold xl:hidden" aria-label="Robots and systems" title="Show robots and systems">
          Robots
        </button>
      </div>
    </header>
  );
}

function Pill({
  label,
  value,
  shown,
  options,
  pick,
}: {
  label: string;
  value: string | null;
  shown?: string;
  options: Option[];
  pick: (v: string | null) => void;
}) {
  return (
    <Popover
      triggerClassName={`rounded-full border px-3 py-1 text-xs font-medium ${
        value ? "border-white bg-white text-accent hover:text-accent" : "border-white/40 text-white hover:border-white hover:bg-white/10 hover:text-white"
      }`}
      trigger={value ? (shown ?? value) : label}
    >
      {(close) => (
        <OptionList
          options={options}
          value={value}
          placeholder={`Search ${label.toLowerCase()}…`}
          onPick={(v) => {
            pick(v);
            close();
          }}
        />
      )}
    </Popover>
  );
}
