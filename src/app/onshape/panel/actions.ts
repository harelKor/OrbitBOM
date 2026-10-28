"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { syncSystem } from "@/app/(app)/parts-actions";
import { requireCapability } from "@/lib/mode";
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
  if (member.onshapeConnected) await syncSystem(system.id);
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
