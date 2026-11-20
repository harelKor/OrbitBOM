// Completion and status breakdown for a robot, a system or a part group (ref §1:
// FRCBOM's status_breakdown). "Done" means a part is in one of the done statuses.

import { DONE_STATUSES, STATUSES } from "@/config/statuses";
import { COTS_PROCESS, getMachine } from "@/config/machines";
import { COTS_STATUSES } from "@/config/cots";
import { computeStatus, isDone, isMidQa, processesOf, type PartStatus, type StatusInput } from "@/lib/status";

// Every status a part can show: the made-part statuses, then the COTS-only ones.
const ALL_STATUSES: { name: PartStatus; color: string }[] = [
  ...STATUSES,
  ...COTS_STATUSES.filter((c) => !STATUSES.some((s) => s.name === c.name)),
];

export type StatusCount = { name: PartStatus; color: string; count: number; percent: number };
export type Breakdown = { total: number; done: number; percent: number; statuses: StatusCount[] };

export function statusBreakdown(parts: StatusInput[]): Breakdown {
  const counts = new Map<PartStatus, number>();
  let midQa = 0;
  for (const part of parts) {
    const status = computeStatus(part);
    counts.set(status, (counts.get(status) ?? 0) + 1);
    if (isMidQa(part)) midQa++;
  }
  const total = parts.length;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  // A Ready for QA before an added process isn't done (Harel, 2026-11-20).
  const done = DONE_STATUSES.reduce((n, s) => n + (counts.get(s) ?? 0), 0) - midQa;
  return {
    total,
    done,
    percent: pct(done),
    statuses: ALL_STATUSES.map((s) => ({
      name: s.name,
      color: s.color,
      count: counts.get(s.name) ?? 0,
      percent: pct(counts.get(s.name) ?? 0),
    })),
  };
}

export type ProcessCount = { id: string; name: string; total: number; done: number; percent: number };

// Completion per machine: of the parts that go through a machine, how many have finished
// that step (its done counter reached the quantity) or are done altogether.
export function processBreakdown(parts: StatusInput[]): ProcessCount[] {
  const counts = new Map<string, { total: number; done: number }>();
  for (const part of parts) {
    const finished = isDone(part);
    for (const { machine: id, done } of processesOf(part)) {
      if (!id || id === COTS_PROCESS) continue;
      const c = counts.get(id) ?? { total: 0, done: 0 };
      c.total += 1;
      if (finished || done >= Math.max(part.quantity, 1)) c.done += 1;
      counts.set(id, c);
    }
  }
  return [...counts]
    .map(([id, c]) => ({ id, name: getMachine(id)?.name ?? id, ...c, percent: Math.round((c.done / c.total) * 100) }))
    .sort((a, b) => b.total - a.total);
}
