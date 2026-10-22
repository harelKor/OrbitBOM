import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { onshapeKeyOf } from "@/lib/inventory/match";
import { parseBom, type OnshapeBom } from "@/lib/onshape/bom";
import { onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { apiPath, parseOnshapeUrl } from "@/lib/onshape/url";
import { planPartUpdate } from "@/lib/parts/changes";
import { planMerge } from "./merge";

const { parts, partHistory, systems, syncJobs, inventoryItems } = schema;

export type SyncSummary = {
  skipped?: "unchanged";
  added: string[];
  updated: number;
  removed: string[];
  relinked: string[];
  restored: string[];
  unknownMachines: string[];
  calls: number;
};

const unchanged = (calls: number): SyncSummary => ({
  skipped: "unchanged",
  added: [],
  updated: 0,
  removed: [],
  relinked: [],
  restored: [],
  unknownMachines: [],
  calls,
});

// Update BOM from Onshape (ref §3, plan §4). With `force` false (the background refresh) it
// first checks the document's microversion and stops if nothing changed; that check costs one
// call and writes no sync job. A manual run (`force`) also makes the member the system's
// background-refresh account.
export async function updateBomFromOnshape(
  systemId: string,
  memberId: string,
  { force = true } = {},
): Promise<SyncSummary> {
  const [system] = await db.select().from(systems).where(eq(systems.id, systemId)).limit(1);
  if (!system) throw new OnshapeError("System not found.");
  const ref = system.assemblyUrl ? parseOnshapeUrl(system.assemblyUrl) : null;
  if (!ref?.eid) throw new OnshapeError("This system has no Onshape assembly URL.");
  const client = onshapeClient(memberId, ref.baseUrl);

  // 1. Change check. A version or microversion link never changes, so only a workspace is checked.
  let microversion: string | null = null;
  if (ref.wvm === "w") {
    const mv = await client.json<{ microversion: string }>(
      `documents/d/${ref.did}/w/${ref.wvmid}/currentmicroversion`,
    );
    microversion = mv.microversion;
  }
  if (!force && (ref.wvm !== "w" || system.docMicroversions[ref.did] === microversion)) {
    await db.update(systems).set({ lastCheckedAt: new Date() }).where(eq(systems.id, systemId));
    return unchanged(client.calls);
  }

  const [job] = await db
    .insert(syncJobs)
    .values({ systemId, kind: force ? "update_bom" : "refresh", state: "running", byMember: memberId, startedAt: new Date() })
    .returning({ id: syncJobs.id });

  try {
    // 2. The assembly BOM with every column, custom properties included.
    await db.update(syncJobs).set({ step: "bom" }).where(eq(syncJobs.id, job.id));
    const bom = await client.json<OnshapeBom>(
      `assemblies/${apiPath(ref)}/bom?indented=false&multiLevel=false&generateIfAbsent=true`,
    );
    const parsed = parseBom(bom);

    // 3. Merge into the system's parts in one transaction.
    const summary = await db.transaction(async (tx) => {
      const existing = await tx.select().from(parts).where(eq(parts.systemId, systemId)).for("update");
      const plan = planMerge(existing, parsed.rows);
      const byId = new Map(existing.map((p) => [p.id, p]));
      const batchId = randomUUID();
      const now = new Date();
      const result: SyncSummary = {
        added: plan.insert.map((r) => r.onshapeName),
        updated: 0,
        removed: plan.remove.map((id) => byId.get(id)?.onshapeName ?? id),
        relinked: [],
        restored: [],
        unknownMachines: parsed.unknownMachines,
        calls: client.calls,
      };

      if (plan.insert.length) {
        // A new part that is an Onshape library part the inventory already knows is linked to it.
        const keys = [...new Set(plan.insert.flatMap((r) => onshapeKeyOf(r) ?? []))];
        const itemOf = new Map(
          keys.length
            ? (await tx.select({ id: inventoryItems.id, key: inventoryItems.onshapeKey }).from(inventoryItems).where(inArray(inventoryItems.onshapeKey, keys))).map((i) => [i.key!, i.id])
            : [],
        );
        await tx.insert(parts).values(
          plan.insert.map((r) => ({
            systemId,
            sourceDid: r.sourceDid,
            sourceWid: r.sourceWid,
            sourceWvm: r.sourceWvm,
            sourceEid: r.sourceEid,
            onshapePartId: r.onshapePartId,
            onshapeName: r.onshapeName,
            partNumber: r.partNumber,
            description: r.description,
            material: r.material,
            quantity: r.quantity,
            preProcess: r.preProcess,
            process1: r.process1,
            process2: r.process2,
            // A part with a process is made in-house; without one nobody has said yet (Undefined).
            classification: r.preProcess || r.process1 || r.process2 ? ("inhouse" as const) : ("undefined" as const),
            geometry: r.onshapeMaterial ? { onshapeMaterial: r.onshapeMaterial } : null,
            inventoryItemId: itemOf.get(onshapeKeyOf(r) ?? "") ?? null,
            lastModifiedBy: memberId,
          })),
        );
      }

      for (const u of plan.update) {
        const part = byId.get(u.id)!;
        const { set, history } = planPartUpdate(part, u.changes, "sync");
        if (history.length) result.updated++;
        if (u.relinked) result.relinked.push(u.identity.onshapeName);
        if (u.restore) result.restored.push(u.identity.onshapeName);
        await tx
          .update(parts)
          .set({
            ...set,
            ...u.identity,
            geometry: { ...(part.geometry ?? {}), onshapeMaterial: u.onshapeMaterial ?? undefined },
            removedFromCadAt: null,
            ...(history.length ? { lastModifiedAt: now, lastModifiedBy: memberId } : {}),
          })
          .where(eq(parts.id, u.id));
        if (history.length) {
          await tx.insert(partHistory).values(
            history.map((h) => ({ partId: u.id, ...h, memberId, via: "sync" as const, batchId })),
          );
        }
      }

      for (const id of plan.remove) {
        await tx
          .update(parts)
          .set({ removedFromCadAt: now })
          .where(and(eq(parts.id, id), eq(parts.isManual, false)));
      }

      await tx
        .update(systems)
        .set({
          lastSyncedAt: now,
          lastCheckedAt: now,
          ...(force ? { refreshMemberId: memberId } : {}),
          docMicroversions: microversion
            ? { ...system.docMicroversions, [ref.did]: microversion }
            : system.docMicroversions,
        })
        .where(eq(systems.id, systemId));
      return result;
    });

    await finishJob(job.id, "done", summary);
    return summary;
  } catch (err) {
    await finishJob(job.id, "failed", null, (err as Error).message);
    throw err;
  }
}

async function finishJob(id: string, state: "done" | "failed", diff: unknown, error?: string) {
  await db
    .update(syncJobs)
    .set({ state, diff, error, step: null, finishedAt: new Date() })
    .where(eq(syncJobs.id, id));
}
