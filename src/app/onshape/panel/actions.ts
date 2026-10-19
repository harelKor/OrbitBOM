"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { syncSystem } from "@/app/(app)/parts-actions";
import { requireMember } from "@/lib/auth";
import { onshapeUrl, parseOnshapeUrl } from "@/lib/onshape/url";

const linkForm = z.object({
  robotId: z.uuid(),
  name: z.string().trim().min(1, "System name is required."),
});

// Creates a system for the assembly the panel is open on, pulls its BOM, and shows it.
export async function linkAssembly(assemblyUrl: string, _: { error?: string } | undefined, formData: FormData) {
  const member = await requireMember();
  const ref = parseOnshapeUrl(assemblyUrl);
  const parsed = linkForm.safeParse(Object.fromEntries(formData));
  if (!ref?.eid) return { error: "Open this panel from an Onshape assembly." };
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [system] = await db
    .insert(schema.systems)
    .values({ robotId: parsed.data.robotId, name: parsed.data.name, assemblyUrl: onshapeUrl(ref) })
    .returning({ id: schema.systems.id });
  // A failed first sync still links; the system page shows Update BOM to retry.
  if (member.onshapeConnected) await syncSystem(system.id);
  redirect(`/robots/${parsed.data.robotId}/systems/${system.id}`);
}
