"use client";

import { getMachine, MACHINES } from "@/config/machines";
import { useFilters } from "@/components/shell/FilterContext";
import { useMaterials } from "@/components/shell/MaterialColors";
import { OptionList, Popover, type Option } from "./Popover";
import type { CardPart } from "./types";

// The BOM filter row's Material and Process pills. They stay set across robot pages. Each lists only
// the materials and processes the page's parts (this system or robot) use (Harel, 2026-11-13); a
// pick carried over from another page stays listed so it can be seen and cleared.
export function FilterPills({ parts }: { parts: Pick<CardPart, "material" | "preProcess" | "process1" | "process2">[] }) {
  const { filters, setFilters } = useFilters();
  const materials = useMaterials();
  const usedMaterials = new Set(parts.map((p) => p.material).filter(Boolean));
  const usedProcesses = new Set(parts.flatMap((p) => [p.preProcess, p.process1, p.process2]).filter(Boolean));
  if (filters.material) usedMaterials.add(filters.material);
  if (filters.process) usedProcesses.add(filters.process);
  const processPick: Option[] = [{ value: null, label: "Any process" }, ...MACHINES.filter((m) => usedProcesses.has(m.id)).map((m) => ({ value: m.id, label: m.name }))];
  // Parts filter by their material's name; items that share a name are one choice.
  const seen = new Set<string>();
  const firstOther = materials.find((g) => !g.raw && g.items.some((i) => usedMaterials.has(i.name)))?.id;
  const materialPick: Option[] = [
    { value: null, label: "Any material" },
    ...materials.flatMap((g) =>
      g.items
        .filter((i) => usedMaterials.has(i.name))
        .flatMap((i, n) => (seen.has(i.name) ? [] : (seen.add(i.name), [{ value: i.name, label: i.name, group: g.label, divider: n === 0 && g.id === firstOther }]))),
    ),
    // A part's material whose inventory item is gone still gets a choice.
    ...[...usedMaterials].filter((m) => m && !seen.has(m)).map((m) => ({ value: m!, label: m!, group: "Other" })),
  ];
  return (
    <div className="flex items-center gap-1.5">
      <Pill label="Material" value={filters.material || null} options={materialPick} pick={(v) => setFilters({ material: v ?? "" })} />
      <Pill
        label="Process"
        value={filters.process || null}
        shown={filters.process ? getMachine(filters.process)?.name : undefined}
        options={processPick}
        pick={(v) => setFilters({ process: v ?? "" })}
      />
      {(filters.material || filters.process) && (
        <button onClick={() => setFilters({ material: "", process: "" })} className="press px-1.5 text-xs text-muted hover:text-fg">
          Clear
        </button>
      )}
    </div>
  );
}

function Pill({ label, value, shown, options, pick }: { label: string; value: string | null; shown?: string; options: Option[]; pick: (v: string | null) => void }) {
  return (
    <Popover
      triggerClassName={`rounded-full border px-3 py-1 text-xs font-medium ${
        value ? "border-accent bg-accent text-white hover:text-white" : "border-line-strong text-fg-2 hover:border-accent/50 hover:bg-raised hover:text-fg"
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
