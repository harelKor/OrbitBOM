"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import type { ModelKind } from "@/db/schema";
import { requireMember } from "@/lib/auth";
import { hasCapability } from "@/lib/mode";
import { VersionError } from "@/lib/versions/commit";
import { deleteVersion } from "@/lib/versions/deleteVersion";
import { draftOf, type Draft } from "@/lib/versions/detect";
import { createRobotVersion, deleteRobotVersion } from "@/lib/versions/robotVersions";
import { isUuid } from "@/lib/uuid";

// The CAD page's version tree menu (plan/cad-versions.md, Harel 2026-11-17).

const VID = /^[0-9a-f]{24}$/i;
type Owner = { systemId: string } | { robotId: string };

async function ownerOk(robotId: string, owner: Owner) {
  if ("robotId" in owner) return owner.robotId === robotId;
  const [s] = await db.select({ id: schema.systems.id }).from(schema.systems).where(and(eq(schema.systems.id, owner.systemId), eq(schema.systems.robotId, robotId)));
  return !!s;
}

// A BOM version's Commit window, as it was committed (read-only).
export async function versionDraft(systemId: string, versionId: string): Promise<{ draft?: Draft; error?: string }> {
  await requireMember();
  if (!isUuid(systemId) || !isUuid(versionId)) return { error: "Unknown version." };
  const [row] = await db
    .select()
    .from(schema.systemVersions)
    .where(and(eq(schema.systemVersions.id, versionId), eq(schema.systemVersions.systemId, systemId), eq(schema.systemVersions.state, "committed")));
  return row ? { draft: draftOf(row) } : { error: "That version is gone." };
}

// Delete version: admins only (it takes part history with it).
export async function deleteTreeVersion(
  robotId: string,
  node: { owner: Owner; kind: ModelKind; did: string | null; vid: string | null; bomIds: string[]; subIds: string[]; ref: { wvm: "v" | "m"; wvmid: string } | null },
): Promise<{ error?: string }> {
  const member = await requireMember();
  if (!member.isAdmin) return { error: "Only an admin deletes versions." };
  const ids = [...node.bomIds, ...node.subIds, robotId, "systemId" in node.owner ? node.owner.systemId : node.owner.robotId];
  if (!ids.every(isUuid) || (node.kind !== "final" && node.kind !== "basepart")) return { error: "Unknown version." };
  if ((node.vid && !VID.test(node.vid)) || (node.did && !VID.test(node.did)) || (node.ref && ((node.ref.wvm !== "v" && node.ref.wvm !== "m") || !VID.test(node.ref.wvmid)))) return { error: "Unknown version." };
  if (!(await ownerOk(robotId, node.owner))) return { error: "Unknown system." };
  try {
    await deleteVersion(node, member.id);
  } catch (err) {
    if (err instanceof VersionError) return { error: err.message };
    throw err;
  }
  revalidatePath("/robots", "layout");
  return {};
}

// Create version on the whole robot: anyone who may update a system (sync).
export async function makeRobotVersion(robotId: string, name: string, note: string): Promise<{ error?: string; label?: string }> {
  const member = await requireMember();
  if (!(await hasCapability("sync"))) return { error: "Only the CAD Team creates robot versions." };
  if (!isUuid(robotId)) return { error: "Unknown robot." };
  try {
    const v = await createRobotVersion(robotId, member.id, name, note);
    revalidatePath("/robots", "layout");
    return { label: v.name };
  } catch (err) {
    if (err instanceof VersionError) return { error: err.message };
    throw err;
  }
}

export async function removeRobotVersion(robotId: string, id: string): Promise<{ error?: string }> {
  const member = await requireMember();
  if (!member.isAdmin) return { error: "Only an admin deletes versions." };
  if (!isUuid(robotId) || !isUuid(id)) return { error: "Unknown version." };
  await deleteRobotVersion(robotId, id);
  revalidatePath("/robots", "layout");
  return {};
}
