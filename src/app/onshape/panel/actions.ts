"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { syncSystem } from "@/app/(app)/parts-actions";
import { requireCapability } from "@/lib/mode";
import { saveLayoutsDocument } from "@/lib/fab/layoutsDocument";
import { buildRobotModelFully } from "@/lib/model/build";
import { refreshPartData } from "@/lib/onshape/thumbnails";
import { pinModelToVersion } from "@/lib/versions/cad";
import { onshapeUrl, parseOnshapeUrl } from "@/lib/onshape/url";

const linkForm = z.object({
  robotId: z.uuid(),
  name: z.string().trim().min(1, "System name is required."),
});

// Creates a system for the assembly the panel is open on, pulls its BOM, and shows it.
export async function linkAssembly(assemblyUrl: string, _: { error?: string } | undefined, formData: FormData) {
  const member = await requireCapability("sync");
  const ref = parseOnshapeUrl(assemblyUrl);
  const parsed = linkForm.safeParse(Object.fromEntries(formData));
  if (!ref?.eid) return { error: "Open this panel from an Onshape assembly." };
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [system] = await db
    .insert(schema.systems)
    .values({ robotId: parsed.data.robotId, name: parsed.data.name, assemblyUrl: onshapeUrl(ref) })
    .returning({ id: schema.systems.id });
  // A failed first sync still links; the system page shows Update System to retry.
  if (member.onshapeConnected) {
    await syncSystem(system.id);
    // A first sync is Update BOM and Update CAD at once: after the system page is on its way, the
    // parts' sheet metal and body types, and the system's 3D at the state the BOM was read at.
    // The pictures are drawn from it by the next CAD member's browser that opens a 3D view.
    after(async () => {
      try {
        await refreshPartData(system.id, member.id);
        const [s] = await db.select({ v: schema.systems.currentVersionId }).from(schema.systems).where(eq(schema.systems.id, system.id));
        if (s?.v) await pinModelToVersion(system.id, s.v);
        await buildRobotModelFully(parsed.data.robotId, member.id);
        revalidatePath("/robots", "layout");
      } catch (err) {
        console.error("First sync's 3D failed", err);
      }
    });
  }
  redirect(`/robots/${parsed.data.robotId}/systems/${system.id}`);
}

// Makes the assembly the panel is open on the robot's main assembly: the 3D view's source.
// Admins only: other members can link subsystem assemblies, not the whole robot.
export async function linkMainAssembly(assemblyUrl: string, _: { error?: string } | undefined, formData: FormData) {
  const member = await requireCapability("sync");
  if (!member.isAdmin) return { error: "Only an admin can set the robot's main assembly." };
  const ref = parseOnshapeUrl(assemblyUrl);
  const robotId = z.uuid().safeParse(formData.get("robotId"));
  if (!ref?.eid) return { error: "Open this panel from an Onshape assembly." };
  if (!robotId.success) return { error: "Pick a robot." };
  await db.update(schema.robots).set({ mainAssemblyUrl: onshapeUrl(ref) }).where(eq(schema.robots.id, robotId.data));
  revalidatePath("/", "layout");
  redirect(`/robots/${robotId.data}#viewer`);
}

// Makes the document the panel is open in a robot's Batch Layouts document: Onshape Layout makes
// that robot's "Batch - <name>" assemblies here.
export async function setBatchLayoutsDocument(documentUrl: string, _: { error?: string; saved?: boolean } | undefined, formData: FormData) {
  const member = await requireCapability("sync");
  const r = await saveLayoutsDocument(String(formData.get("robotId") ?? ""), documentUrl, member);
  if (!r.error) revalidatePath("/", "layout");
  return r;
}
