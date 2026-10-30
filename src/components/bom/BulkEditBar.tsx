"use client";

import { useState } from "react";
import { MACHINES } from "@/config/machines";
import type { MaterialGroup } from "@/lib/data/materials";
import { findMaterial } from "./options";
import { useMaterials } from "@/components/shell/MaterialColors";
import { STATUSES } from "@/config/statuses";
import type { PartChanges } from "@/lib/parts/changes";

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

function valueOptions(field: FieldId, materials: MaterialGroup[]) {
  switch (field) {
    case "classification":
      return [
        <option key="inhouse" value="inhouse">In-House</option>,
        <option key="cots" value="cots">COTS</option>,
      ];
    case "material":
      return [
        <option key={NONE} value={NONE}>— None —</option>,
        // Raw Stock first, then the other inventory categories; the value is the item id.
        ...materials.map((g) => (
          <optgroup key={g.id} label={g.raw ? g.label : `${g.label} · inventory`}>
            {g.items.map((i) => (
              <option key={i.id} value={i.id}>{`${i.label} (${i.stock})`}</option>
            ))}
          </optgroup>
        )),
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
  const [field, setField] = useState<FieldId>("status");
  const [value, setValue] = useState("");

  function apply() {
    if (!value || !count) return;
    if (field === "material") {
      const item = findMaterial(materials, value);
      onApply(item ? { material: item.name, inventoryItemId: item.id } : { material: null, inventoryItemId: null });
      return;
    }
    onApply({ [field]: value === NONE ? null : value } as PartChanges);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-surface/95 p-3 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{count} selected</span>
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
        <select value={value} onChange={(e) => setValue(e.target.value)} className="input w-auto" aria-label="Value">
          <option value="">— Value —</option>
          {valueOptions(field, materials)}
        </select>
        <button className="btn-primary" disabled={!value || !count} onClick={apply}>
          Apply
        </button>
        <button className="btn" onClick={onSelectAll}>
          Select all ({total})
        </button>
        <button className="btn ml-auto" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
