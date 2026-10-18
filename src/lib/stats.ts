// Completion and status breakdown for a robot, a system or a part group (ref §1:
// FRCBOM's status_breakdown). "Done" means a part is in one of the done statuses.

import { DONE_STATUSES, STATUSES, type StatusName } from "@/config/statuses";
import { computeStatus, type StatusInput } from "@/lib/status";

export type StatusCount = { name: StatusName; color: string; count: number; percent: number };
export type Breakdown = { total: number; done: number; percent: number; statuses: StatusCount[] };

export function statusBreakdown(parts: StatusInput[]): Breakdown {
  const counts = new Map<StatusName, number>();
  for (const part of parts) {
    const status = computeStatus(part);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const total = parts.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const done = DONE_STATUSES.reduce((n, s) => n + (counts.get(s) ?? 0), 0);
  return {
    total,
    done,
    percent: pct(done),
    statuses: STATUSES.map((s) => ({
      name: s.name,
      color: s.color,
      count: counts.get(s.name) ?? 0,
      percent: pct(counts.get(s.name) ?? 0),
    })),
  };
}
