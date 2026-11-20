import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { packsByMaterial } from "@/config/machines";
import { db, schema } from "@/db";
import { cachedQuery } from "@/lib/data/cache";
import { computeStatus, factoryOf } from "@/lib/status";

const { parts, systems, robots, partGroups, groupMembers } = schema;

// A pack is named after its material ("No material" for parts without one).
export const packName = (material: string | null) => material || "No material";

// Zivudim packs its Released parts by itself: each loose Released part joins the open pack of its
// material (one whose parts are all still Released, so not sent yet), else a new pack named after
// the material (Harel, 2026-11-04). Run when the factory's pages load; the robot row is locked so
// two loads at once don't make the same pack twice. Returns how many parts were packed.
export async function autoPackByMaterial(robotId: string, factory: string): Promise<number> {
  if (!packsByMaterial(factory)) return 0;
  if (!(await hasLooseReleased(robotId, factory))) return 0;
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ part: parts })
      .from(parts)
      .innerJoin(systems, eq(systems.id, parts.systemId))
      .where(and(eq(systems.robotId, robotId), isNull(parts.removedFromCadAt)));
    const mine = rows.map((r) => r.part).filter((p) => p.classification !== "cots" && factoryOf(p) === factory);
    const released = mine.filter((p) => computeStatus(p) === "Released");
    if (!released.length) return 0;

    const members = await tx
      .select({ groupId: partGroups.id, partId: groupMembers.partId })
      .from(partGroups)
      .innerJoin(groupMembers, eq(groupMembers.groupId, partGroups.id))
      .where(and(eq(partGroups.robotId, robotId), eq(partGroups.machine, factory)));
    const packed = new Set(members.map((m) => m.partId));
    const loose = released.filter((p) => !packed.has(p.id));
    if (!loose.length) return 0;

    await tx.select({ id: robots.id }).from(robots).where(eq(robots.id, robotId)).for("update");
    // Read again under the lock: another load may have packed them meanwhile.
    const now = await tx
      .select({ partId: groupMembers.partId })
      .from(groupMembers)
      .innerJoin(partGroups, eq(partGroups.id, groupMembers.groupId))
      .where(and(eq(partGroups.machine, factory), inArray(groupMembers.partId, loose.map((p) => p.id))));
    const taken = new Set(now.map((m) => m.partId));
    const todo = loose.filter((p) => !taken.has(p.id));
    if (!todo.length) return 0;

    // Open packs: every part on the BOM still Released. Their material is their members' (the name
    // says it too, but members win if the name was changed).
    const byId = new Map(mine.map((p) => [p.id, p]));
    const packs = new Map<string, (typeof mine)[number][]>();
    for (const m of members) packs.set(m.groupId, [...(packs.get(m.groupId) ?? []), ...(byId.has(m.partId) ? [byId.get(m.partId)!] : [])]);
    const openFor = new Map<string, string>(); // material -> pack id
    for (const [id, list] of packs) {
      if (!list.length || !list.every((p) => computeStatus(p) === "Released")) continue;
      const material = list[0].material ?? "";
      if (list.every((p) => (p.material ?? "") === material) && !openFor.has(material)) openFor.set(material, id);
    }

    for (const p of todo) {
      const material = p.material ?? "";
      let groupId = openFor.get(material);
      if (!groupId) {
        [{ id: groupId }] = await tx.insert(partGroups).values({ robotId, name: packName(p.material), machine: factory }).returning({ id: partGroups.id });
        openFor.set(material, groupId);
      }
      await tx
        .insert(groupMembers)
        .values({ groupId, partId: p.id, keySnapshot: { did: p.sourceDid, eid: p.sourceEid, partId: p.onshapePartId, name: p.onshapeName ?? p.displayName } })
        .onConflictDoNothing();
    }
    return todo.length;
  });
}

// The cheap check before the write transaction: is any of the factory's Released parts still in no
// pack? Usually none, and every visit to its pages opened a transaction and read the robot's full
// parts rows before (2026-11-14). The status columns come from the server's memory.
async function hasLooseReleased(robotId: string, factory: string): Promise<boolean> {
  const rows = await cachedQuery(
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
    ["parts", "systems"],
  );
  const released = rows.filter((p) => p.classification !== "cots" && factoryOf(p) === factory && computeStatus(p) === "Released").map((p) => p.id);
  if (!released.length) return false;
  const packed = await db
    .selectDistinct({ partId: groupMembers.partId })
    .from(groupMembers)
    .innerJoin(partGroups, eq(partGroups.id, groupMembers.groupId))
    .where(and(eq(partGroups.machine, factory), inArray(groupMembers.partId, released)));
  return packed.length < released.length;
}
