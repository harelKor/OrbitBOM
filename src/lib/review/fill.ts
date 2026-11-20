import type { PartChanges } from "@/lib/parts/changes";

// A suggestion fills empty fields and may change filled ones, but never empties one (audit,
// 2026-11-20: a COTS guess turned a part's "Stainless Steel" into none). Read on the locked row.
const emptyValue = (v: unknown) => v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "string" && /^(none|undefined)$/i.test(v.trim()));
export function keepFilled(row: { addedProcesses: { machine: string }[] } & Record<string, unknown>, changes: PartChanges): PartChanges {
  const out: Record<string, unknown> = { ...changes };
  for (const [field, value] of Object.entries(changes)) {
    const now = field === "process2" ? (row.addedProcesses[0]?.machine ?? null) : row[field];
    if (emptyValue(value) && !emptyValue(now)) delete out[field];
  }
  return out as PartChanges;
}
