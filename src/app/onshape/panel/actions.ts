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
import { refreshThumbnails } from "@/lib/onshape/thumbnails";
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
    const started = Date.now();
    await syncSystem(system.id);
    // The new system's thumbnails, after the system page is on its way; what's left is
    // fetched on the next Update System.
    after(async () => {
      const t = await refreshThumbnails(system.id, member.id, started + 240_000).catch((err) => console.error("Thumbnails failed", err));
      if (t?.fetched) revalidatePath("/robots", "layout");
    });
  }
  redirect(`/robots/${parsed.data.robotId}/systems/${system.id}`);
}

// Makes the assembly the panel is open on the robot's main assembly: the 3D view's source.
export async function linkMainAssembly(assemblyUrl: string, _: { error?: string } | undefined, formData: FormData) {
  await requireCapability("sync");
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
