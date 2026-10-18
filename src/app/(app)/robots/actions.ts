"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireAdmin, requireMember } from "@/lib/auth";
import { onshapeUrl, parseOnshapeUrl } from "@/lib/onshape/url";

export type FormState = { error?: string } | undefined;

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
  await requireMember();
  const parsed = robotForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const [robot] = await db
    .insert(schema.robots)
    .values({ ...parsed.data, mainAssemblyUrl: normaliseUrl(parsed.data.mainAssemblyUrl) })
    .returning({ id: schema.robots.id });
  revalidatePath("/");
  redirect(`/robots/${robot.id}`);
}

const robotDetails = z.object({
  name: z.string().trim().min(1).optional(),
  code: optionalText.optional(),
  deadline: optionalText
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid date")
    .optional(),
});

export async function updateRobot(robotId: string, formData: FormData) {
  await requireMember();
  const data = robotDetails.parse(Object.fromEntries(formData));
  await db.update(schema.robots).set(data).where(eq(schema.robots.id, robotId));
  revalidatePath(`/robots/${robotId}`);
}

export async function setRobotArchived(robotId: string, archived: boolean) {
  await requireMember();
  await db.update(schema.robots).set({ archived }).where(eq(schema.robots.id, robotId));
  revalidatePath("/");
}

export async function deleteRobot(robotId: string) {
  await requireAdmin();
  await db.delete(schema.robots).where(eq(schema.robots.id, robotId));
  revalidatePath("/");
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
  await requireMember();
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
  revalidatePath(`/robots/${robotId}`);
  redirect(`/robots/${robotId}/systems/${system.id}`);
}

export async function renameSystem(robotId: string, systemId: string, formData: FormData) {
  await requireMember();
  const name = z.string().trim().min(1).parse(formData.get("name"));
  await db.update(schema.systems).set({ name }).where(eq(schema.systems.id, systemId));
  revalidatePath(`/robots/${robotId}`);
  revalidatePath(`/robots/${robotId}/systems/${systemId}`);
}

export async function deleteSystem(robotId: string, systemId: string) {
  await requireAdmin();
  await db.delete(schema.systems).where(eq(schema.systems.id, systemId));
  revalidatePath(`/robots/${robotId}`);
}
