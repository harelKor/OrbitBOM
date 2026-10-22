// Completion and status breakdown for a robot, a system or a part group (ref §1:
// FRCBOM's status_breakdown). "Done" means a part is in one of the done statuses.

import { DONE_STATUSES, STATUSES } from "@/config/statuses";
import { getMachine } from "@/config/machines";
import { COTS_STATUSES } from "@/config/cots";
import { computeStatus, isDone, type PartStatus, type StatusInput } from "@/lib/status";

// Every status a part can show: the made-part statuses, then the COTS-only ones.
const ALL_STATUSES: { name: PartStatus; color: string }[] = [
  ...STATUSES,
  ...COTS_STATUSES.filter((c) => !STATUSES.some((s) => s.name === c.name)),
];

export type StatusCount = { name: PartStatus; color: string; count: number; percent: number };
export type Breakdown = { total: number; done: number; percent: number; statuses: StatusCount[] };

export function statusBreakdown(parts: StatusInput[]): Breakdown {
  const counts = new Map<PartStatus, number>();
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
  const slots = [
    ["preProcess", "donePreprocess"],
    ["process1", "doneProcess1"],
    ["process2", "doneProcess2"],
  ] as const;
  const counts = new Map<string, { total: number; done: number }>();
  for (const part of parts) {
    const finished = isDone(part);
    for (const [machine, done] of slots) {
      const id = part[machine];
      if (!id) continue;
      const c = counts.get(id) ?? { total: 0, done: 0 };
      c.total += 1;
      if (finished || part[done] >= Math.max(part.quantity, 1)) c.done += 1;
      counts.set(id, c);
    }
  }
  return [...counts]
    .map(([id, c]) => ({ id, name: getMachine(id)?.name ?? id, ...c, percent: Math.round((c.done / c.total) * 100) }))
    .sort((a, b) => b.total - a.total);
}
