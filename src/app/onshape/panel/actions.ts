"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import type { GeometrySketch } from "@/db/schema";
import { syncSystem } from "@/app/(app)/parts-actions";
import { requireCapability } from "@/lib/mode";
import { saveLayoutsDocument } from "@/lib/fab/layoutsDocument";
import { buildRobotModelFully } from "@/lib/model/build";
import { refreshPartData } from "@/lib/onshape/thumbnails";
import { pinModelToVersion } from "@/lib/versions/cad";
import { onshapeUrl, parseOnshapeUrl } from "@/lib/onshape/url";

// A new system ("new" and its name) or one the robot already has.
const systemForm = z.object({
  robotId: z.uuid(),
  systemId: z.union([z.literal("new"), z.uuid()]).default("new"),
  name: z.string().trim().optional(),
});
function parseSystem(formData: FormData): { error: string } | { robotId: string; systemId: string | null; name: string } {
  const parsed = systemForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { robotId, systemId, name } = parsed.data;
  if (systemId === "new" && !name) return { error: "System name is required." };
  return { robotId, systemId: systemId === "new" ? null : systemId, name: name ?? "" };
}

// Creates a system for the assembly the panel is open on, or links it to a system that so far
// has only its Basepart, as the system's Final (Harel, 2026-11-12); pulls its BOM, and goes back to
// the panel's own home (Update system, Comment…), not the whole site (Harel, 2026-11-13).
// `query`: the panel's place (place.ts).
export async function linkAssembly(assemblyUrl: string, query: string, _: { error?: string } | undefined, formData: FormData) {
  const member = await requireCapability("sync");
  const ref = parseOnshapeUrl(assemblyUrl);
  const parsed = parseSystem(formData);
  if (!ref?.eid) return { error: "Open this panel from an Onshape assembly." };
  if ("error" in parsed) return { error: parsed.error };
  let system: { id: string } | undefined;
  if (parsed.systemId) {
    [system] = await db
      .update(schema.systems)
      .set({ assemblyUrl: onshapeUrl(ref) })
      .where(and(eq(schema.systems.id, parsed.systemId), eq(schema.systems.robotId, parsed.robotId), isNull(schema.systems.assemblyUrl)))
      .returning({ id: schema.systems.id });
    if (!system) return { error: "That system already has its Final assembly. Pick another, or a new system." };
  } else {
    [system] = await db
      .insert(schema.systems)
      .values({ robotId: parsed.robotId, name: parsed.name, assemblyUrl: onshapeUrl(ref) })
      .returning({ id: schema.systems.id });
  }
  // A failed first sync still links; the system page shows Update System to retry.
  const systemId = system.id;
  if (member.onshapeConnected) {
    await syncSystem(systemId);
    // A first sync is Update BOM and Update CAD at once: after the system page is on its way, the
    // parts' sheet metal and body types, and the system's 3D at the state the BOM was read at.
    // The pictures are drawn from it by the next CAD member's browser that opens a 3D view.
    after(async () => {
      try {
        await refreshPartData(systemId, member.id);
        const [s] = await db.select({ v: schema.systems.currentVersionId }).from(schema.systems).where(eq(schema.systems.id, systemId));
        if (s?.v) await pinModelToVersion(systemId, s.v);
        await buildRobotModelFully(parsed.robotId, member.id);
        revalidatePath("/robots", "layout");
      } catch (err) {
        console.error("First sync's 3D failed", err);
      }
    });
  }
  redirect(`/onshape/panel?${query}`);
}

// ---------- Basepart (Harel, 2026-11-12) ----------

const sketchList = z.array(z.object({ id: z.string().min(1).max(100), name: z.string().max(200) })).max(300);
function parseSketches(formData: FormData): GeometrySketch[] | null {
  try {
    const r = sketchList.safeParse(JSON.parse(String(formData.get("sketches") ?? "[]")));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// The Basepart model again, after the response: the panel goes back to its home at once.
function rebuildBasepart(robotId: string, memberId: string, connected: boolean) {
  if (!connected) return;
  after(async () => {
    try {
      await buildRobotModelFully(robotId, memberId, 10 * 60_000, "basepart");
      revalidatePath("/robots", "layout");
    } catch (err) {
      console.error("Basepart 3D failed", err);
    }
  });
}

// Sync as system Basepart / Sync as robot Basepart: the Part Studio the panel is open on becomes
// the system's (new or existing) or the robot's Basepart, with the Geometry sketches chosen. No
// BOM: that comes from the Final assembly. Robot: admins only.
export async function syncBasepart(studioUrl: string, query: string, target: "system" | "robot", _: { error?: string } | undefined, formData: FormData) {
  const member = await requireCapability("sync");
  if (target === "robot" && !member.isAdmin) return { error: "Only an admin can set the robot's Basepart." };
  const ref = parseOnshapeUrl(studioUrl);
  if (!ref?.eid || ref.wvm !== "w") return { error: "Open the Part Studio on its workspace (not a version)." };
  const sketches = parseSketches(formData);
  if (!sketches) return { error: "Those sketches didn't come through. Reopen the panel." };
  const url = onshapeUrl(ref);
  const fields = { basepartUrl: url, basepartKind: "partstudio" as const, basepartStudioUrl: url, basepartSketches: sketches };
  let robotId: string;
  if (target === "robot") {
    const id = z.uuid().safeParse(formData.get("robotId"));
    if (!id.success) return { error: "Pick a robot." };
    const [r] = await db.update(schema.robots).set(fields).where(eq(schema.robots.id, id.data)).returning({ id: schema.robots.id });
    if (!r) return { error: "That robot is gone." };
    robotId = r.id;
  } else {
    const parsed = parseSystem(formData);
    if ("error" in parsed) return { error: parsed.error };
    robotId = parsed.robotId;
    if (parsed.systemId) {
      const [s] = await db
        .update(schema.systems)
        .set(fields)
        .where(and(eq(schema.systems.id, parsed.systemId), eq(schema.systems.robotId, robotId)))
        .returning({ id: schema.systems.id });
      if (!s) return { error: "That system is gone." };
    } else await db.insert(schema.systems).values({ robotId, name: parsed.name, ...fields });
  }
  rebuildBasepart(robotId, member.id, member.onshapeConnected);
  revalidatePath("/", "layout");
  redirect(`/onshape/panel?${query}`);
}

// Replace as system Basepart / Replace as robot Basepart: the assembly the panel is open on takes
// the place of the Basepart Part Studio in the same document. The Geometry sketches stay (still
// read from that Part Studio, where the assembly places it). Robot: admins only.
export async function replaceBasepart(assemblyUrl: string, query: string, target: "system" | "robot", _: { error?: string } | undefined, formData: FormData) {
  const member = await requireCapability("sync");
  if (target === "robot" && !member.isAdmin) return { error: "Only an admin can replace the robot's Basepart." };
  const ref = parseOnshapeUrl(assemblyUrl);
  if (!ref?.eid || ref.wvm !== "w") return { error: "Open the assembly on its workspace (not a version)." };
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: target === "robot" ? "Pick a robot." : "Pick a system." };
  const set = { basepartUrl: onshapeUrl(ref), basepartKind: "assembly" as const };
  let robotId: string | undefined;
  let was: string | null | undefined;
  if (target === "robot") {
    const [r] = await db.select({ url: schema.robots.basepartUrl }).from(schema.robots).where(eq(schema.robots.id, id.data));
    [robotId, was] = [r ? id.data : undefined, r?.url];
  } else {
    const [s] = await db.select({ url: schema.systems.basepartUrl, robotId: schema.systems.robotId }).from(schema.systems).where(eq(schema.systems.id, id.data));
    [robotId, was] = [s?.robotId, s?.url];
  }
  if (!robotId || (was ? parseOnshapeUrl(was)?.did : null) !== ref.did) return { error: "Its Basepart Part Studio isn't in this document." };
  if (target === "robot") await db.update(schema.robots).set(set).where(eq(schema.robots.id, id.data));
  else await db.update(schema.systems).set(set).where(eq(schema.systems.id, id.data));
  rebuildBasepart(robotId, member.id, member.onshapeConnected);
  revalidatePath("/", "layout");
  redirect(`/onshape/panel?${query}`);
}

// The Geometry sketches chosen again, from the panel's Geometry page.
export async function saveGeometry(target: "system" | "robot", id: string, query: string, _: { error?: string } | undefined, formData: FormData) {
  const member = await requireCapability("sync");
  if (target === "robot" && !member.isAdmin) return { error: "Only an admin can change the robot's Geometry." };
  const sketches = parseSketches(formData);
  if (!sketches) return { error: "Those sketches didn't come through. Reopen the panel." };
  if (!z.uuid().safeParse(id).success) return { error: "Unknown system." };
  let robotId: string | undefined;
  if (target === "robot") {
    const [r] = await db.update(schema.robots).set({ basepartSketches: sketches }).where(eq(schema.robots.id, id)).returning({ id: schema.robots.id });
    robotId = r?.id;
  } else {
    const [s] = await db.update(schema.systems).set({ basepartSketches: sketches }).where(eq(schema.systems.id, id)).returning({ robotId: schema.systems.robotId });
    robotId = s?.robotId;
  }
  if (!robotId) return { error: "That system is gone." };
  rebuildBasepart(robotId, member.id, member.onshapeConnected);
  revalidatePath("/", "layout");
  redirect(`/onshape/panel?${query}`);
}

// Makes the assembly the panel is open on the robot's main assembly: the 3D view's source.
// Admins only: other members can link subsystem assemblies, not the whole robot. Back to the
// panel's home afterwards, like a system's link.
export async function linkMainAssembly(assemblyUrl: string, query: string, _: { error?: string } | undefined, formData: FormData) {
  const member = await requireCapability("sync");
  if (!member.isAdmin) return { error: "Only an admin can set the robot's main assembly." };
  const ref = parseOnshapeUrl(assemblyUrl);
  const robotId = z.uuid().safeParse(formData.get("robotId"));
  if (!ref?.eid) return { error: "Open this panel from an Onshape assembly." };
  if (!robotId.success) return { error: "Pick a robot." };
  await db.update(schema.robots).set({ mainAssemblyUrl: onshapeUrl(ref) }).where(eq(schema.robots.id, robotId.data));
  revalidatePath("/", "layout");
  redirect(`/onshape/panel?${query}`);
}

// Makes the document the panel is open in a robot's Batch Layouts document: Onshape Layout makes
// that robot's "Batch - <name>" assemblies here.
export async function setBatchLayoutsDocument(documentUrl: string, _: { error?: string; saved?: boolean } | undefined, formData: FormData) {
  const member = await requireCapability("sync");
  const r = await saveLayoutsDocument(String(formData.get("robotId") ?? ""), documentUrl, member);
  if (!r.error) revalidatePath("/", "layout");
  return r;
}
