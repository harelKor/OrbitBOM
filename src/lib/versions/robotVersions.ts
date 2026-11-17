import "server-only";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { RobotVersionSystem } from "@/db/schema";
import { keepCurrentSnapshot } from "@/lib/model/snapshots";
import { versionLabel } from "./label";
import { VersionError } from "./commit";

const { members, robotVersions, systems, systemVersions } = schema;

// The whole robot's own versions (Create version, Harel 2026-11-17): "R1", "R2"… each records the
// state every system's Final 3D model is on at that moment (its kept snapshot), and the BOM
// version it's on, so the robot is drawn and compared as it was then. No Onshape calls.

export async function createRobotVersion(robotId: string, memberId: string, name: string, note: string) {
  const rows = await db
    .select({ id: systems.id, name: systems.name, current: systemVersions })
    .from(systems)
    .leftJoin(systemVersions, eq(systemVersions.id, systems.currentVersionId))
    .where(and(eq(systems.robotId, robotId), isNotNull(systems.assemblyUrl)))
    .orderBy(asc(systems.name));
  if (!rows.length) throw new VersionError("Link the robot's systems to Onshape first.");
  const list: RobotVersionSystem[] = [];
  for (const r of rows) {
    const ref = await keepCurrentSnapshot(robotId, "final", { systemId: r.id });
    list.push({ systemId: r.id, name: r.name, kind: "final", ref, label: r.current ? versionLabel(r.current) : null });
  }
  if (!list.some((s) => s.ref)) throw new VersionError("No system's 3D model is on a fixed version yet: update a system (Update BOM with 3D views, or Update CAD) first.");
  return db.transaction(async (tx) => {
    const [last] = await tx.select({ seq: robotVersions.seq }).from(robotVersions).where(eq(robotVersions.robotId, robotId)).orderBy(desc(robotVersions.seq)).limit(1).for("update");
    const seq = (last?.seq ?? 0) + 1;
    const [row] = await tx
      .insert(robotVersions)
      .values({ robotId, seq, name: name.trim().slice(0, 120) || `R${seq}`, note: note.trim().slice(0, 2000) || null, systems: list, memberId })
      .returning();
    return row;
  });
}

export async function deleteRobotVersion(robotId: string, id: string) {
  await db.delete(robotVersions).where(and(eq(robotVersions.robotId, robotId), eq(robotVersions.id, id)));
}

export type RobotVersionRow = { id: string; seq: number; name: string; note: string | null; at: string; by: string | null; systems: RobotVersionSystem[] };

export async function listRobotVersions(robotId: string): Promise<RobotVersionRow[]> {
  const rows = await db
    .select({ v: robotVersions, by: members.name })
    .from(robotVersions)
    .leftJoin(members, eq(members.id, robotVersions.memberId))
    .where(eq(robotVersions.robotId, robotId))
    .orderBy(desc(robotVersions.seq));
  return rows.map(({ v, by }) => ({ id: v.id, seq: v.seq, name: v.name, note: v.note, at: v.createdAt.toISOString(), by, systems: v.systems }));
}
