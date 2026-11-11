import "server-only";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { logCalls, onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { addKeptVersion, keptDocVersions, nextVersionName, readDocVersions } from "./docVersions";

const { cadUpdates, systems, systemVersions } = schema;

// Update CAD in the Onshape panel (Harel, 2026-11-11): this system's 3D (the CAD page and every
// 3D view) moves to the assembly as it is now, and the CAD version tree gets a node. With
// "Create version" an Onshape version is made and is that node; without, the update is a
// sub-version "V12 v1" of the newest Onshape version, pinned to the workspace's microversion, so
// a rebuild never reads it again. 1 call (the microversion), +1 when the kept version list is
// old, +1 for a new version; the 3D rebuild that follows reads only this system's assembly.

const FRESH_MS = 2 * 60_000;

export type CadUpdateResult = { label: string; robotId: string; unchanged?: boolean; calls: number };

export async function updateCad(systemId: string, memberId: string, { makeVersion, name }: { makeVersion: boolean; name?: string }): Promise<CadUpdateResult> {
  const [system] = await db.select().from(systems).where(eq(systems.id, systemId));
  if (!system) throw new OnshapeError("System not found.");
  const asm = system.assemblyUrl ? parseOnshapeUrl(system.assemblyUrl) : null;
  if (!asm?.eid) throw new OnshapeError("This system has no Onshape assembly URL.");
  if (asm.wvm !== "w") throw new OnshapeError("This system is linked to a fixed Onshape version, so its CAD can't move. Link its workspace to use Update CAD.");
  const client = onshapeClient(memberId, asm.baseUrl);
  try {
    const { microversion } = await client.json<{ microversion: string }>(`documents/d/${asm.did}/w/${asm.wvmid}/currentmicroversion`);
    const [last] = await db.select().from(cadUpdates).where(eq(cadUpdates.systemId, systemId)).orderBy(desc(cadUpdates.createdAt)).limit(1);
    if (!makeVersion && last?.microversion === microversion) {
      await pin(systemId, last.onshapeVersionId ? { wvm: "v", wvmid: last.onshapeVersionId } : { wvm: "m", wvmid: microversion });
      return { label: last.label, robotId: system.robotId, unchanged: true, calls: client.calls };
    }

    let kept = await keptDocVersions(asm.did);
    const versions = makeVersion || !kept || Date.now() - kept.at.getTime() > FRESH_MS ? await readDocVersions(client, asm.did) : kept.versions;

    if (makeVersion) {
      const typed = name?.trim().slice(0, 120);
      const label = typed || nextVersionName(versions);
      const made = await client.json<{ id: string; name?: string; createdAt?: string; creator?: { name?: string } }>(`documents/d/${asm.did}/versions`, {
        method: "POST",
        body: JSON.stringify({ documentId: asm.did, workspaceId: asm.wvmid, name: label, microversionId: microversion }),
      });
      await addKeptVersion(asm.did, { ...made, name: made.name ?? label });
      await db.insert(cadUpdates).values({ systemId, did: asm.did, microversion, onshapeVersionId: made.id, label: made.name ?? label, memberId });
      await pin(systemId, { wvm: "v", wvmid: made.id });
      return { label: made.name ?? label, robotId: system.robotId, calls: client.calls };
    }

    kept = await keptDocVersions(asm.did);
    const list = kept?.versions ?? [];
    const parent = list.reduce<(typeof list)[number] | null>((a, v) => (!a || v.createdAt > a.createdAt ? v : a), null);
    if (!parent) throw new OnshapeError("This design has no Onshape version yet: tick Create version for the first one.");
    const [{ n }] = await db
      .select({ n: count() })
      .from(cadUpdates)
      .where(and(eq(cadUpdates.systemId, systemId), eq(cadUpdates.parentVersionId, parent.id), isNull(cadUpdates.onshapeVersionId)));
    const label = `${parent.name} v${n + 1}`;
    await db.insert(cadUpdates).values({ systemId, did: asm.did, microversion, parentVersionId: parent.id, label, memberId });
    await pin(systemId, { wvm: "m", wvmid: microversion });
    return { label, robotId: system.robotId, calls: client.calls };
  } finally {
    logCalls("update-cad", client);
  }
}

async function pin(systemId: string, modelRef: { wvm: "v" | "m"; wvmid: string }) {
  await db.update(systems).set({ modelRef }).where(eq(systems.id, systemId));
}

// Update BOM with "Update 3D views" ticked: the 3D moves to the state the BOM version was read
// at (its Onshape version, or the microversion the check read). A database write only; the
// rebuild that follows reads only this system's assembly. Returns the robot to rebuild.
export async function pinModelToVersion(systemId: string, versionId: string): Promise<string | null> {
  const [row] = await db
    .select({ ref: systemVersions.onshapeRef, url: systems.assemblyUrl, robotId: systems.robotId })
    .from(systemVersions)
    .innerJoin(systems, eq(systems.id, systemVersions.systemId))
    .where(eq(systemVersions.id, versionId));
  const asm = row?.url ? parseOnshapeUrl(row.url) : null;
  if (!row || !asm || !row.ref) return row?.robotId ?? null;
  // The assembly document's own version (a BOM release or a followed version), else the
  // microversion the check read.
  const own = row.ref.sources?.[asm.did]?.versionId ?? (row.ref.did === asm.did ? row.ref.vid : undefined);
  const modelRef = own ? { wvm: "v" as const, wvmid: own } : row.ref.mv && row.ref.did === asm.did ? { wvm: "m" as const, wvmid: row.ref.mv } : null;
  if (modelRef) await pin(systemId, modelRef);
  return row.robotId;
}

// The tree's sub-versions of a system (updates without an Onshape version of their own).
export async function listCadSubs(systemId: string) {
  const rows = await db
    .select({ id: cadUpdates.id, parentVid: cadUpdates.parentVersionId, label: cadUpdates.label, at: cadUpdates.createdAt, by: schema.members.name })
    .from(cadUpdates)
    .leftJoin(schema.members, eq(schema.members.id, cadUpdates.memberId))
    .where(and(eq(cadUpdates.systemId, systemId), isNull(cadUpdates.onshapeVersionId)));
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
}
