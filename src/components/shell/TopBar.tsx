"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { getMachine, MACHINES } from "@/config/machines";
import { MATERIAL_OPTIONS } from "@/components/bom/options";
import { OptionList, Popover, type Option } from "@/components/bom/Popover";
import { DATE_OPTIONS, useFilters, type DateFilter, type Filters } from "./FilterContext";
import { ModeToggle } from "./ModeContext";

const PROCESS_OPTIONS: Option[] = [{ value: null, label: "Any process" }, ...MACHINES.map((m) => ({ value: m.id, label: m.name }))];
const DATE_PICK: Option[] = [{ value: null, label: "Any time" }, ...DATE_OPTIONS.map((d) => ({ value: d.value, label: d.label }))];
const MATERIAL_PICK: Option[] = [{ value: null, label: "Any material" }, ...MATERIAL_OPTIONS.filter((o) => o.value)];

export function TopBar({ onMenu, onRobots }: { onMenu: () => void; onRobots: () => void }) {
  const pathname = usePathname();
  const { filters, setFilters } = useFilters();
  const search = useRef<HTMLInputElement>(null);
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

  const active = filters.q || filters.material || filters.process || filters.date;

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-line bg-ink/95 px-4 py-2.5 backdrop-blur md:px-6">
      <button onClick={onMenu} className="btn px-2 lg:hidden" aria-label="Pages">
        ☰
      </button>
      {partPages && (
        <>
          <div className="relative min-w-40 flex-1 md:max-w-sm">
            <input
              ref={search}
              value={filters.q}
              onChange={(e) => setFilters({ q: e.target.value })}
              placeholder="Search part name or number"
              className="input pr-14"
            />
            <kbd className="absolute top-1.5 right-2 rounded border border-line-strong px-1.5 text-[11px] text-slate-500">Ctrl K</kbd>
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
                className="press px-1.5 text-xs text-slate-400 hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
        </>
      )}
      <div className="ml-auto flex items-center gap-2">
        <ModeToggle />
        <button onClick={onRobots} className="btn px-2 text-xs xl:hidden" aria-label="Robots and systems">
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
        value ? "border-accent bg-accent text-white hover:text-white" : "border-line-strong text-slate-300 hover:border-slate-400 hover:bg-raised hover:text-white"
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
