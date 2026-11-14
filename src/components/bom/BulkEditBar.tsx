"use client";

import { useState } from "react";
import { MACHINES } from "@/config/machines";
import { pickMaterial } from "./options";
import { MaterialPicker } from "./fields";
import { useMaterials } from "@/components/shell/MaterialColors";
import { STATUSES } from "@/config/statuses";
import type { PartChanges } from "@/lib/parts/changes";
import { RESET_SPECS } from "@/components/shell/mode";
import { useCan } from "@/components/shell/ModeContext";
import { askConfirm } from "@/components/ui/useConfirm";

// FRCBOM's Bulk edit bar (ref §3): N selected · Field · Value · Apply · Select all · Done.
const FIELDS = [
  { id: "classification", label: "Type (COTS / In-House)" },
  { id: "material", label: "Material" },
  { id: "preProcess", label: "Pre Process" },
  { id: "process1", label: "Process 1" },
  { id: "process2", label: "Process 2" },
  { id: "status", label: "Status" },
] as const;
type FieldId = (typeof FIELDS)[number]["id"];

const NONE = "__none__";

// Bigger controls than the page's: taller, base-size text.
const BIG = "[&_.btn]:h-10 [&_.btn]:text-base [&_.btn]:whitespace-nowrap [&_.btn-primary]:h-10 [&_.btn-primary]:px-4 [&_.btn-primary]:text-base [&_.input]:h-10 [&_.input]:text-base";

function valueOptions(field: Exclude<FieldId, "material">) {
  switch (field) {
    case "classification":
      return [
        <option key="inhouse" value="inhouse">In-House</option>,
        <option key="cots" value="cots">COTS</option>,
      ];
    case "status":
      return STATUSES.map((s) => <option key={s.name}>{s.name}</option>);
    default: {
      const stage = field === "preProcess" ? "PreProcess" : "Process";
      return [
        <option key={NONE} value={NONE}>— None —</option>,
        ...MACHINES.filter((m) => m.stage === stage).map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        )),
      ];
    }
  }
}

export function BulkEditBar({
  count,
  total,
  onApply,
  onSelectAll,
  onDone,
}: {
  count: number;
  total: number;
  onApply: (changes: PartChanges) => void;
  onSelectAll: () => void;
  onDone: () => void;
}) {
  const materials = useMaterials();
  // The part window's reset, for every selected part at once; same people (Harel, 2026-11-05).
  const canReset = useCan("classify");
  const [field, setField] = useState<FieldId>("status");
  const [value, setValue] = useState("");

  function apply() {
    if (!value || !count) return;
    if (field === "material") {
      onApply(pickMaterial(materials, value));
      return;
    }
    onApply({ [field]: value === NONE ? null : value } as PartChanges);
  }

  // Between the side columns, so Done isn't hidden under the robots column. A little bigger than
  // the other bars, with an accent edge and a shadow, so it's quick to hit (Harel, 2026-11-10).
  return (
    <div className="fixed bottom-0 left-[var(--shell-left)] right-[var(--shell-right)] z-40 border-t-[3px] border-accent/60 bg-surface/95 px-4 py-2 shadow-[0_-10px_28px_-12px_rgba(17,19,24,0.35)] backdrop-blur">
      <div className={`mx-auto flex max-w-6xl flex-wrap items-center gap-2 text-base md:flex-nowrap ${BIG}`}>
        <span className="text-lg font-semibold whitespace-nowrap tabular-nums">{count} selected</span>
        <select
          value={field}
          onChange={(e) => {
            setField(e.target.value as FieldId);
            setValue("");
          }}
          className="input w-auto"
          aria-label="Field"
        >
          {FIELDS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
        {field === "material" ? (
          // Searchable, so general materials can be found too.
          <MaterialPicker value={value === NONE ? null : value || null} onChange={(v) => setValue(v ?? NONE)} placeholder="— Value —" />
        ) : (
          <select value={value} onChange={(e) => setValue(e.target.value)} className="input w-auto" aria-label="Value">
            <option value="">— Value —</option>
            {valueOptions(field)}
          </select>
        )}
        <button className="btn-primary" disabled={!value || !count} onClick={apply}>
          Apply
        </button>
        <button className="btn" onClick={onSelectAll}>
          Select all ({total})
        </button>
        {canReset && (
          <button
            className="btn"
            disabled={!count}
            onClick={async () => {
              if (await askConfirm({ title: `Reset ${count} part${count === 1 ? "" : "s"}?`, body: "Their type, status, material, machines, inventory link and counts go back to blank.", confirm: "Reset", danger: true })) onApply({ ...RESET_SPECS });
            }}
          >
            Reset specs
          </button>
        )}
        <button className="btn ml-auto" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
