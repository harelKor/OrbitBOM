import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { FACTORY_FAB_MACHINES, PRINTERS, type FabArea } from "@/config/machines";
import { db, schema } from "@/db";
import { AREA_READY, areaQueue } from "@/lib/fab";
import { areaOf, computeStatus } from "@/lib/status";

const { parts, systems, partGroups, groupMembers } = schema;

export type FactoryCount = { id: string; name: string; queue: number; released: number; packs: number };

// Factory Fab's or 3D Printing's boxes: per factory or printer, the parts waiting there, the loose
// Released ones and the packs not yet all In Stock. Reads only the status columns, never pictures.
export async function countArea(robotId: string, area: FabArea): Promise<FactoryCount[]> {
  const machines = area === "factory" ? FACTORY_FAB_MACHINES : PRINTERS;
  const ids = machines.map((m) => m.id as string);
  const [rows, packRows] = await Promise.all([
    db
      .select({
        id: parts.id,
        classification: parts.classification,
        quantity: parts.quantity,
        designState: parts.designState,
        process1: parts.process1,
        doneProcess1: parts.doneProcess1,
        addedProcesses: parts.addedProcesses,
        qaHeld: parts.qaHeld,
        cotsQa: parts.cotsQa,
      })
      .from(parts)
      .innerJoin(systems, eq(systems.id, parts.systemId))
      .where(and(eq(systems.robotId, robotId), isNull(parts.removedFromCadAt))),
    db
      .select({ groupId: partGroups.id, machine: partGroups.machine, partId: groupMembers.partId })
      .from(partGroups)
      .innerJoin(groupMembers, eq(groupMembers.groupId, partGroups.id))
      .where(and(eq(partGroups.robotId, robotId), inArray(partGroups.machine, ids))),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const packed = new Set(packRows.map((r) => r.partId));
  const counts = new Map<string, FactoryCount>(machines.map((m) => [m.id, { id: m.id, name: m.name, queue: 0, released: 0, packs: 0 }]));
  for (const r of rows) {
    const f = areaQueue(r, area);
    if (!f) continue;
    const c = counts.get(f)!;
    c.queue += 1;
    if (!packed.has(r.id) && AREA_READY[area].includes(computeStatus(r))) c.released += 1;
  }
  // A pack counts while any part on the BOM in it isn't In Stock yet.
  const open = new Set<string>();
  for (const r of packRows) {
    const p = byId.get(r.partId);
    if (p && areaOf(p) === area && computeStatus(p) !== "In Stock") open.add(`${r.machine}|${r.groupId}`);
  }
  for (const key of open) {
    const c = counts.get(key.split("|")[0]);
    if (c) c.packs += 1;
  }
  return [...counts.values()];
}
