"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MACHINES } from "@/config/machines";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { applyPartChanges } from "@/lib/parts/apply";
import { partChangesSchema } from "@/lib/parts/changes";
import { isUuid } from "@/lib/uuid";

export type ActionResult = { error?: string };

export async function updatePart(partId: string, changes: unknown): Promise<ActionResult> {
  const member = await requireMember();
  if (!isUuid(partId)) return { error: "Unknown part." };
  const parsed = partChangesSchema.safeParse(changes);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await applyPartChanges([partId], parsed.data, { memberId: member.id, via: "ui" });
  revalidatePath("/robots", "layout");
  return {};
}

const machine = z.union([z.literal(""), z.enum(MACHINES.map((m) => m.id) as [string, ...string[]])]);

const manualPart = z.object({
  name: z.string().trim().min(1, "Part name is required."),
  quantity: z.coerce.number().int().min(0),
  material: z.string().trim(),
  description: z.string().trim(),
  preProcess: machine,
  process1: machine,
  process2: machine,
  drawingUrl: z.union([z.literal(""), z.url("The drawing link must be a URL.")]),
});

export async function addManualPart(
  systemId: string,
  _: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const member = await requireMember();
  const parsed = manualPart.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const orNull = (v: string) => v || null;
  await db.insert(schema.parts).values({
    systemId,
    isManual: true,
    displayName: d.name,
    quantity: d.quantity,
    material: orNull(d.material),
    description: orNull(d.description),
    preProcess: orNull(d.preProcess),
    process1: orNull(d.process1),
    process2: orNull(d.process2),
    drawingUrl: orNull(d.drawingUrl),
    lastModifiedBy: member.id,
  });
  revalidatePath("/robots", "layout");
  return {};
}

// Only manual parts can be deleted; Onshape parts come back on the next sync.
export async function deleteManualPart(partId: string): Promise<ActionResult> {
  await requireMember();
  if (!isUuid(partId)) return { error: "Unknown part." };
  await db
    .delete(schema.parts)
    .where(and(eq(schema.parts.id, partId), eq(schema.parts.isManual, true)));
  revalidatePath("/robots", "layout");
  return {};
}
