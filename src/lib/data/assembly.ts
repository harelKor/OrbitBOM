import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { assemblySteps, assemblySubs, assemblyTicks, members, parts, systems, type StepCamera } from "@/db/schema";
import { subCodeOf } from "@/lib/assembly/groups";
import { partKey } from "@/lib/model/assembly";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { imageUrl } from "@/lib/storage/r2";

// Everything the Assembly page shows (plan/assembly-guides.md): the robot's systems, its parts with
// their sub-assembly (from the part number), the names CAD gave sub-assemblies, and the steps with
// their ticks. Database only, no Onshape.
// `key`: the part's 3D model key, or `id:<part id>` for a part that isn't placed in the model
// (a COTS card added by hand): it still joins a step's parts list, just not its 3D.
export type AssemblyPart = { key: string; id: string; systemId: string; name: string; number: string | null; qty: number; sub: string | null; cots: boolean; thumbUrl: string | null };
export type AssemblyStep = {
  id: string;
  systemId: string;
  subCode: string | null;
  position: number;
  kind: "step" | "sub";
  subRef: string | null;
  title: string;
  body: string;
  critical: boolean;
  partKeys: string[];
  stepRefs: string[]; // earlier steps of the same column brought in whole
  camera: StepCamera | null;
  imageKey: string | null;
  imageUrl: string | null;
  tick: { by: string | null; at: string } | null;
};
export type AssemblyData = {
  systems: { id: string; name: string }[];
  parts: AssemblyPart[];
  subNames: Record<string, string>; // "<systemId>:<code>" → name
  steps: AssemblyStep[];
};

export async function loadAssembly(robotId: string): Promise<AssemblyData> {
  const sysRows = await db.select({ id: systems.id, name: systems.name }).from(systems).where(eq(systems.robotId, robotId)).orderBy(asc(systems.name));
  const ids = sysRows.map((s) => s.id);
  if (!ids.length) return { systems: [], parts: [], subNames: {}, steps: [] };
  const [partRows, subRows, stepRows] = await Promise.all([
    db
      .select({
        id: parts.id,
        systemId: parts.systemId,
        did: parts.sourceDid,
        eid: parts.sourceEid,
        pid: parts.onshapePartId,
        displayName: parts.displayName,
        onshapeName: parts.onshapeName,
        partNumber: parts.partNumber,
        quantity: parts.quantity,
        classification: parts.classification,
        thumbnailRev: parts.thumbnailRev,
      })
      .from(parts)
      .where(and(inArray(parts.systemId, ids), isNull(parts.removedFromCadAt))),
    db.select().from(assemblySubs).where(inArray(assemblySubs.systemId, ids)),
    db
      .select({ step: assemblySteps, tickAt: assemblyTicks.doneAt, tickBy: members.name })
      .from(assemblySteps)
      .leftJoin(assemblyTicks, eq(assemblyTicks.stepId, assemblySteps.id))
      .leftJoin(members, eq(members.id, assemblyTicks.memberId))
      .where(inArray(assemblySteps.systemId, ids))
      .orderBy(asc(assemblySteps.position), asc(assemblySteps.createdAt)),
  ]);
  // Thumbnail links are signed locally (no network), so every part gets one.
  const partsOut: AssemblyPart[] = (
    await Promise.all(
      partRows.map(async (r) => {
        if (!r.systemId) return null;
        const name = r.displayName ?? r.onshapeName ?? "Unnamed part";
        const key = r.did && r.eid && r.pid ? partKey(r.did, r.eid, r.pid) : `id:${r.id}`;
        const thumbUrl = r.thumbnailRev ? await imageUrl(thumbKey(r.id, r.thumbnailRev)) : null;
        return { key, id: r.id, systemId: r.systemId, name, number: r.partNumber, qty: r.quantity, sub: subCodeOf(r.partNumber, r.displayName, r.onshapeName), cots: r.classification === "cots", thumbUrl };
      }),
    )
  ).filter((p): p is AssemblyPart => !!p);
  const steps = await Promise.all(
    stepRows.map(async ({ step: s, tickAt, tickBy }) => ({
      id: s.id,
      systemId: s.systemId,
      subCode: s.subCode,
      position: s.position,
      kind: s.kind,
      subRef: s.subRef,
      title: s.title,
      body: s.body,
      critical: s.critical,
      partKeys: s.partKeys,
      stepRefs: s.stepRefs,
      camera: s.camera,
      imageKey: s.imageKey,
      imageUrl: s.imageKey ? await imageUrl(s.imageKey) : null,
      tick: tickAt ? { by: tickBy, at: tickAt.toISOString() } : null,
    })),
  );
  return {
    systems: sysRows,
    parts: partsOut,
    subNames: Object.fromEntries(subRows.map((r) => [`${r.systemId}:${r.code}`, r.name])),
    steps,
  };
}
