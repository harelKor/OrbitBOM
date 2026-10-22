import { MACHINES, type MachineStage } from "@/config/machines";
import { MATERIALS } from "@/config/materials";
import { PRIORITIES } from "@/config/priorities";
import { STATUSES } from "@/config/statuses";
import type { Option } from "./Popover";

export const STATUS_OPTIONS: Option[] = STATUSES.map((s) => ({ value: s.name, label: s.name, color: s.color }));

export const MATERIAL_OPTIONS: Option[] = [
  { value: null, label: "— None —" },
  ...Object.entries(MATERIALS).flatMap(([group, list]) => list.map((m) => ({ value: m, label: m, group }))),
];

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
];

// Black or white text, whichever reads better on a status color.
export function textOn(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#020617" : "#ffffff";
}
