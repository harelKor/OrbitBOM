"use client";

import { getMachine, MACHINES } from "@/config/machines";
import { useFilters } from "@/components/shell/FilterContext";
import { useMaterials } from "@/components/shell/MaterialColors";
import { OptionList, Popover, type Option } from "./Popover";

const PROCESS_OPTIONS: Option[] = [{ value: null, label: "Any process" }, ...MACHINES.map((m) => ({ value: m.id, label: m.name }))];

// The BOM filter row's Material and Process pills. They stay set across robot pages.
export function FilterPills() {
  const { filters, setFilters } = useFilters();
  const materials = useMaterials();
  // Parts filter by their material's name; items that share a name are one choice.
  const seen = new Set<string>();
  const firstOther = materials.find((g) => !g.raw)?.id;
  const materialPick: Option[] = [
    { value: null, label: "Any material" },
    ...materials.flatMap((g) =>
      g.items.flatMap((i, n) => (seen.has(i.name) ? [] : (seen.add(i.name), [{ value: i.name, label: i.name, group: g.label, divider: n === 0 && g.id === firstOther }]))),
    ),
  ];
  return (
    <div className="flex items-center gap-1.5">
      <Pill label="Material" value={filters.material || null} options={materialPick} pick={(v) => setFilters({ material: v ?? "" })} />
      <Pill
        label="Process"
        value={filters.process || null}
        shown={filters.process ? getMachine(filters.process)?.name : undefined}
        options={PROCESS_OPTIONS}
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
