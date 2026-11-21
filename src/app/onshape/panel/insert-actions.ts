"use server";

import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ModelKind } from "@/db/schema";
import { getMember } from "@/lib/auth";
import { hasCapability } from "@/lib/mode";
import { logCalls, onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { insertParts, newestCadVersionsOf, resolveSystemParts, updateDerived, versionName, type InsertTarget } from "@/lib/onshape/insert";
import { featureName, groupParts } from "@/lib/onshape/insertPlan";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { isUuid } from "@/lib/uuid";
import { readDocVersions } from "@/lib/versions/docVersions";
import { panelPlace } from "./place";

const { systems } = schema;

export type InsertAnswer = { error?: string; message?: string; skipped?: string[] };

// Who may insert: the CAD Team (sync or shape) and admins (Harel, 2026-11-21).
async function inserter() {
  const member = await getMember();
  if (!member) return { error: "Sign in first." } as const;
  if (!member.isAdmin && !(await hasCapability("sync")) && !(await hasCapability("shape"))) return { error: "Only the CAD Team can insert parts." } as const;
  if (!member.onshapeConnected) return { error: "Connect your Onshape account first (Profile → Connect Onshape)." } as const;
  return { member } as const;
}

// Where the panel is open, from its own query (the server reads it again; nothing is trusted).
function targetOf(query: string): InsertTarget | null {
  const place = panelPlace(Object.fromEntries(new URLSearchParams(query)));
  return place.ref?.eid ? { ...place.ref, eid: place.ref.eid, kind: place.kind } : null;
}

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export type RobotPick = { systemId: string; versionId: string; keys: string[] };

// Insert from robot: the chosen parts of each system at the version shown for it.
export async function insertFromRobot(query: string, model: ModelKind, picks: RobotPick[]): Promise<InsertAnswer> {
  const who = await inserter();
  if ("error" in who) return { error: who.error };
  const target = targetOf(query);
  if (!target) return { error: "Open this panel from an Onshape Part Studio or assembly." };
  if (!picks.length || picks.some((p) => !isUuid(p.systemId) || !/^[0-9a-f]{24}$/.test(p.versionId) || !p.keys.length)) return { error: "Choose parts to insert." };
  const client = onshapeClient(who.member.id, target.baseUrl);
  const done: string[] = [];
  const skipped: string[] = [];
  let total = 0;
  try {
    for (const pick of picks) {
      const [sys] = await db
        .select({ name: systems.name, assemblyUrl: systems.assemblyUrl, basepartUrl: systems.basepartUrl, basepartKind: systems.basepartKind })
        .from(systems)
        .where(eq(systems.id, pick.systemId));
      const url = model === "basepart" ? sys?.basepartUrl : sys?.assemblyUrl;
      const ref = url ? parseOnshapeUrl(url) : null;
      if (!sys || !ref?.eid) {
        skipped.push(`${sys?.name ?? "A system"} has no ${model === "basepart" ? "Basepart" : "Final"} linked`);
        continue;
      }
      // The version must be one of the system's own document (from its CAD updates or its kept
      // version list); a sub-version "V12 v1" has no Onshape version to reference.
      const v = await versionName(ref.did, pick.versionId);
      if (!v) {
        skipped.push(`${sys.name}: that version isn't one of its Onshape versions`);
        continue;
      }
      const kind = model === "basepart" && sys.basepartKind === "partstudio" ? "partstudio" : "assembly";
      const { parts, skipped: notFound } = await resolveSystemParts(client, { did: ref.did, eid: ref.eid, kind }, pick.versionId, pick.keys);
      skipped.push(...notFound.map((s) => `${sys.name} ${s}`));
      if (!parts.length) continue;
      const modelName = model === "basepart" ? "Basepart" : "Final";
      const r = await insertParts(client, target, parts, {
        label: `${sys.name} · ${modelName} · ${v.name}`,
        featureName: featureName(sys.name, model, v.name),
        systemId: pick.systemId,
        systemVersionId: pick.versionId,
        model,
        memberId: who.member.id,
      });
      skipped.push(...r.skipped.map((s) => `${sys.name} ${s}`));
      if (r.inserted) {
        total += r.inserted;
        done.push(`${r.inserted} part${r.inserted === 1 ? "" : "s"} from ${sys.name} · ${modelName} · ${v.name}${v.cadUpdate ? ` (CAD update ${day(v.cadUpdate)})` : ""}`);
      }
    }
  } catch (err) {
    return { error: err instanceof OnshapeError || err instanceof Error ? err.message : "Insert failed.", message: done.length ? `Inserted ${done.join("; ")} before it stopped.` : undefined, skipped };
  } finally {
    logCalls("insert", client);
  }
  if (!total) return { error: "Nothing was inserted.", skipped };
  return { message: `Inserted ${done.join("; ")}.`, skipped };
}

// The systems' newest CAD-updated Onshape version each (Harel's choice: the panel opens there).
export async function newestCadVersions(robotId: string, model: ModelKind) {
  if (!isUuid(robotId) || !(await getMember())) return {};
  const m = await newestCadVersionsOf({ robotId }, model);
  return Object.fromEntries([...m].map(([id, v]) => [id, { versionId: v.versionId, label: v.label, at: v.at.toISOString() }]));
}

// Insert from shelf (Harel, 2026-11-21): each item's linked library part (did:eid:partId) at the
// newest version of its document (1 call per document, plus 1 per Part Studio to see whether it is
// configured). Configured parts (McMaster-style per-length configurations) are skipped for now.
export async function insertFromShelf(query: string, itemIds: string[]): Promise<InsertAnswer> {
  const who = await inserter();
  if ("error" in who) return { error: who.error };
  const target = targetOf(query);
  if (!target) return { error: "Open this panel from an Onshape Part Studio or assembly." };
  const ids = [...new Set(itemIds)].filter(isUuid).slice(0, 50);
  if (!ids.length) return { error: "Choose items to insert." };
  const items = await db.select({ id: schema.inventoryItems.id, name: schema.inventoryItems.name, key: schema.inventoryItems.onshapeKey }).from(schema.inventoryItems).where(inArray(schema.inventoryItems.id, ids));
  const client = onshapeClient(who.member.id, target.baseUrl);
  const skipped: string[] = [];
  const done: string[] = [];
  let total = 0;
  const newestOf = new Map<string, { id: string; name: string } | null>();
  const configured = new Map<string, boolean>();
  try {
    for (const item of items) {
      const [did, eid, partId] = (item.key ?? "").split(":");
      if (!did || !eid || !partId) {
        skipped.push(`${item.name}: no Onshape part linked`);
        continue;
      }
      if (!newestOf.has(did)) {
        const list = await readDocVersions(client, did);
        const top = list.filter((v) => v.createdAt).sort((a, b) => a.createdAt!.localeCompare(b.createdAt!)).at(-1);
        newestOf.set(did, top ? { id: top.id, name: top.name ?? "Version" } : null);
      }
      const v = newestOf.get(did);
      if (!v) {
        skipped.push(`${item.name}: its Onshape document has no version yet`);
        continue;
      }
      const ck = `${did}:${v.id}:${eid}`;
      if (!configured.has(ck)) {
        const c = await client.json<{ configurationParameters?: unknown[] }>(`elements/d/${did}/v/${v.id}/e/${eid}/configuration`);
        configured.set(ck, !!c.configurationParameters?.length);
      }
      if (configured.get(ck)) {
        skipped.push(`${item.name}: configured parts (like McMaster's per-length ones) aren't supported yet`);
        continue;
      }
      const r = await insertParts(client, target, [{ did, eid, partId, versionId: v.id }], { label: `${item.name} · ${v.name}`, featureName: featureName(item.name, null, v.name), itemId: item.id, memberId: who.member.id });
      skipped.push(...r.skipped.map((s) => `${item.name}: ${s.replace(/^[^:]*: /, "")}`));
      if (r.inserted) {
        total += r.inserted;
        done.push(`${item.name} · ${v.name}`);
      }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Insert failed.", message: done.length ? `Inserted ${done.join(", ")} before it stopped.` : undefined, skipped };
  } finally {
    logCalls("insert-shelf", client);
  }
  if (!total) return { error: "Nothing was inserted.", skipped };
  return { message: `Inserted ${done.join(", ")}.`, skipped };
}

// Update on an "Inserted here" row (Harel, 2026-11-21): the Derived feature moves to the system's
// newest CAD update. An assembly instance isn't switched through Onshape's API here, so it says how.
export async function updateInsert(query: string, insertId: string): Promise<InsertAnswer> {
  const who = await inserter();
  if ("error" in who) return { error: who.error };
  const target = targetOf(query);
  if (!target || !isUuid(insertId)) return { error: "Unknown insert." };
  if (target.wvm !== "w") return { error: "Open the document's workspace (not a version) to update it." };
  const { onshapeInserts } = schema;
  const [row] = await db.select().from(onshapeInserts).where(and(eq(onshapeInserts.id, insertId), eq(onshapeInserts.targetDid, target.did), eq(onshapeInserts.targetEid, target.eid)));
  if (!row?.systemId) return { error: "Only parts inserted from a system can be updated." };
  const model: ModelKind = row.model ?? "final";
  const newest = (await newestCadVersionsOf({ systemIds: [row.systemId] }, model)).get(row.systemId);
  if (!newest || newest.versionId === row.systemVersionId) return { message: "Already at the newest CAD update." };
  if (row.targetKind === "assembly") return { error: `In Onshape, right-click each of these instances → Change version… and pick ${newest.label}. OrbitParts can't switch an assembly instance's version yet.` };
  const [sys] = await db.select({ name: systems.name, assemblyUrl: systems.assemblyUrl, basepartUrl: systems.basepartUrl, basepartKind: systems.basepartKind }).from(systems).where(eq(systems.id, row.systemId));
  const ref = parseOnshapeUrl((model === "basepart" ? sys?.basepartUrl : sys?.assemblyUrl) ?? "");
  if (!sys || !ref?.eid || !row.createdIds[0]) return { error: "That system isn't linked any more." };
  const client = onshapeClient(who.member.id, target.baseUrl);
  try {
    const kind = model === "basepart" && sys.basepartKind === "partstudio" ? "partstudio" : "assembly";
    const { parts } = await resolveSystemParts(client, { did: ref.did, eid: ref.eid, kind }, newest.versionId, row.partIds.map((p) => `${row.sourceDid}:${row.sourceEid}:${p}`));
    const [g] = groupParts(parts);
    if (!g) return { error: `Those parts aren't in ${sys.name} at ${newest.label} any more.` };
    await updateDerived(client, { did: target.did, wid: target.wvmid, eid: target.eid }, row.createdIds[0], featureName(sys.name, model, newest.label), g);
    const label = `${sys.name} · ${model === "basepart" ? "Basepart" : "Final"} · ${newest.label}`;
    await db.update(onshapeInserts).set({ versionId: g.versionId, systemVersionId: newest.versionId, partIds: g.partIds, label, updatedAt: new Date() }).where(eq(onshapeInserts.id, row.id));
    return { message: `Updated to ${label} (CAD update ${day(newest.at)}).` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Update failed." };
  } finally {
    logCalls("insert-update", client);
  }
}
