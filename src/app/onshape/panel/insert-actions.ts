"use server";

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ModelKind } from "@/db/schema";
import { getMember } from "@/lib/auth";
import { hasCapability } from "@/lib/mode";
import { logCalls, onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { insertParts, resolveSystemParts, versionName, type InsertTarget } from "@/lib/onshape/insert";
import { featureName } from "@/lib/onshape/insertPlan";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { isUuid } from "@/lib/uuid";
import { panelPlace } from "./place";

const { cadUpdates, systems } = schema;

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
  const rows = await db
    .selectDistinctOn([cadUpdates.systemId], { systemId: cadUpdates.systemId, versionId: cadUpdates.onshapeVersionId, label: cadUpdates.label, at: cadUpdates.createdAt })
    .from(cadUpdates)
    .innerJoin(systems, eq(systems.id, cadUpdates.systemId))
    .where(and(eq(systems.robotId, robotId), eq(cadUpdates.model, model), isNotNull(cadUpdates.onshapeVersionId)))
    .orderBy(cadUpdates.systemId, desc(cadUpdates.createdAt));
  return Object.fromEntries(rows.map((r) => [r.systemId!, { versionId: r.versionId!, label: r.label, at: r.at.toISOString() }]));
}
