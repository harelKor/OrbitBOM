import { MACHINES, type MachineStage } from "@/config/machines";
import type { MaterialGroup } from "@/lib/data/materials";
import { PRIORITIES } from "@/config/priorities";
import { COTS_STATUSES } from "@/config/cots";
import { STATUSES } from "@/config/statuses";
import type { Option } from "./Popover";

export const STATUS_OPTIONS: Option[] = STATUSES.map((s) => ({ value: s.name, label: s.name, color: s.color }));
export const COTS_STATUS_OPTIONS: Option[] = COTS_STATUSES.map((s) => ({ value: s.name, label: s.name, color: s.color }));

// The inventory items a part's material can be (useMaterials()) as menu options by category:
// Raw Stock first, then the other categories under a divider. Values are item ids.
export function materialOptions(materials: MaterialGroup[]): Option[] {
  const firstOther = materials.find((g) => !g.raw)?.id;
  return [
    { value: null, label: "— None —" },
    ...materials.flatMap((g) =>
      g.items.map((i, n) => ({ value: i.id, label: i.label, group: g.label, hint: i.stock, divider: n === 0 && g.id === firstOther })),
    ),
  ];
}

// An item id's item, from useMaterials().
export function findMaterial(materials: MaterialGroup[], id: string | null | undefined) {
  if (!id) return undefined;
  for (const g of materials) {
    const item = g.items.find((i) => i.id === id);
    if (item) return item;
  }
  return undefined;
}

export function machineOptions(stage: MachineStage): Option[] {
  return [
    { value: null, label: "— None —" },
    ...MACHINES.filter((m) => m.stage === stage).map((m) => ({ value: m.id, label: m.name })),
  ];
}

export const PRIORITY_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  normal: "#64748b",
  low: "#334155",
};

export const PRIORITY_OPTIONS: Option[] = PRIORITIES.map((p) => ({
  value: p,
  label: p[0].toUpperCase() + p.slice(1),
  color: PRIORITY_COLORS[p],
}));

// External is off for 1690 (plan §2).
export const TYPE_OPTIONS: Option[] = [
  { value: "inhouse", label: "IN-HOUSE" },
  { value: "cots", label: "COTS" },
  { value: "undefined", label: "UNDEFINED" },
];

// Black or white text, whichever reads better on a status color.
export function textOn(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#020617" : "#ffffff";
}
