"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { requireCapability } from "@/lib/mode";
import { fileKeysFor } from "@/lib/storage/cleanup";
import { deleteToTrash } from "@/lib/trash";
import { saveLayoutsDocument } from "@/lib/fab/layoutsDocument";
import { onshapeUrl, parseOnshapeUrl } from "@/lib/onshape/url";

export type FormState = { error?: string; saved?: boolean } | undefined;

const optionalText = z
  .string()
  .trim()
  .transform((v) => v || null);

// An optional Onshape element URL, normalised; anything else is an error.
const optionalOnshapeUrl = optionalText.refine(
  (v) => v === null || !!parseOnshapeUrl(v)?.eid,
  "Paste an Onshape link to an assembly (…/documents/…/w/…/e/…).",
);
const normaliseUrl = (v: string | null) => (v ? onshapeUrl(parseOnshapeUrl(v)!) : null);

const robotForm = z.object({
  name: z.string().trim().min(1, "Robot name is required."),
  year: z.coerce.number().int().min(2000, "Competition year is required.").max(2100),
  mainAssemblyUrl: optionalOnshapeUrl,
});


export async function createRobot(_: FormState, formData: FormData): Promise<FormState> {
  await requireCapability("manage");
  const parsed = robotForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [robot] = await db
    .insert(schema.robots)
    .values({ ...parsed.data, mainAssemblyUrl: normaliseUrl(parsed.data.mainAssemblyUrl) })
    .returning({ id: schema.robots.id });
  revalidatePath("/", "layout");
  redirect(`/robots/${robot.id}`);
}

const robotDetails = z.object({
  name: z.string().trim().min(1, "Robot name is required.").optional(),
  year: z.coerce.number().int().min(2000, "Enter a competition year.").max(2100).optional(),
  code: optionalText.optional(),
  deadline: optionalText
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid date")
    .optional(),
  mainAssemblyUrl: optionalOnshapeUrl.optional(),
});

export async function updateRobot(robotId: string, formData: FormData): Promise<FormState> {
  await requireCapability("manage");
  const parsed = robotDetails.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { mainAssemblyUrl, ...data } = parsed.data;
  await db
    .update(schema.robots)
    .set({ ...data, ...(mainAssemblyUrl !== undefined ? { mainAssemblyUrl: normaliseUrl(mainAssemblyUrl) } : {}) })
    .where(eq(schema.robots.id, robotId));
  revalidatePath("/", "layout");
  return { saved: true };
}

export async function setRobotArchived(robotId: string, archived: boolean) {
  await requireCapability("manage");
  await db.update(schema.robots).set({ archived }).where(eq(schema.robots.id, robotId));
  revalidatePath("/", "layout");
}

// Deleting keeps a copy in Recently deleted (Settings) for 30 days, with its files and its
// built 3D model (lib/trash.ts), so an admin can bring the robot back.
export async function deleteRobot(robotId: string) {
  const member = await requireAdmin();
  const [robot] = await db.select({ name: schema.robots.name }).from(schema.robots).where(eq(schema.robots.id, robotId));
  if (!robot) redirect("/");
  const fileKeys = await fileKeysFor({ robotId });
  const where = eq(schema.robots.id, robotId);
  await db.transaction((tx) => deleteToTrash(tx, { kind: "robot", label: robot.name, root: schema.robots, where, memberId: member.id, fileKeys }));
  revalidatePath("/", "layout");
  redirect("/");
}

const systemForm = z.object({
  name: z.string().trim().min(1, "System name is required."),
  assemblyUrl: optionalOnshapeUrl,
});

export async function createSystem(
  robotId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireCapability("manage");
  const parsed = systemForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  // Subassembly and part-studio discovery runs once Onshape is connected (sync milestone).
  const [system] = await db
    .insert(schema.systems)
    .values({
      robotId,
      name: parsed.data.name,
      assemblyUrl: normaliseUrl(parsed.data.assemblyUrl),
    })
    .returning({ id: schema.systems.id });
  revalidatePath("/", "layout");
  redirect(`/robots/${robotId}/systems/${system.id}`);
}

export async function updateSystem(systemId: string, _: FormState, formData: FormData): Promise<FormState> {
  await requireCapability("manage");
  const parsed = systemForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const assemblyUrl = normaliseUrl(parsed.data.assemblyUrl);
  const [current] = await db.select({ assemblyUrl: schema.systems.assemblyUrl }).from(schema.systems).where(eq(schema.systems.id, systemId));
  await db
    .update(schema.systems)
    .set({
      name: parsed.data.name,
      assemblyUrl,
      // A new assembly is a new document: the next background check must not skip it.
      ...(current?.assemblyUrl !== assemblyUrl ? { docMicroversions: {} } : {}),
    })
    .where(eq(schema.systems.id, systemId));
  revalidatePath("/", "layout");
  return { saved: true };
}

// Kept in Recently deleted for 30 days, like a robot.
export async function deleteSystem(robotId: string, systemId: string) {
  const member = await requireAdmin();
  const [system] = await db.select({ name: schema.systems.name }).from(schema.systems).where(eq(schema.systems.id, systemId));
  if (system) {
    const fileKeys = await fileKeysFor({ systemId });
    const where = eq(schema.systems.id, systemId);
    await db.transaction((tx) => deleteToTrash(tx, { kind: "system", label: system.name, root: schema.systems, where, memberId: member.id, fileKeys }));
  }
  revalidatePath("/", "layout");
  redirect(`/robots/${robotId}`);
}

// Settings: the robot's Batch Layouts document (src/lib/fab/layoutsDocument.ts). Empty clears it,
// so Onshape Layout goes back to the system's own document.
export async function setLayoutsDocument(robotId: string, link: string): Promise<FormState> {
  const member = await requireCapability("manage");
  const r = await saveLayoutsDocument(robotId, link, member);
  if (!r.error) revalidatePath("/", "layout");
  return r;
}

