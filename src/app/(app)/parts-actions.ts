"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MACHINES } from "@/config/machines";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { OnshapeError } from "@/lib/onshape/client";
import { applyPartChanges } from "@/lib/parts/apply";
import { partChangesSchema } from "@/lib/parts/changes";
import { updateBomFromOnshape } from "@/lib/sync/updateBom";
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

export type SyncResult = { error?: string; message?: string };

export async function syncSystem(systemId: string): Promise<SyncResult> {
  const member = await requireMember();
  if (!isUuid(systemId)) return { error: "Unknown system." };
  if (!member.onshapeConnected) return { error: "Connect your Onshape account first (Profile → Connect Onshape)." };
  try {
    const s = await updateBomFromOnshape(systemId, member.id, { force: true });
    revalidatePath("/robots", "layout");
    const parts = [
      `${s.added.length} added`,
      `${s.updated} updated`,
      `${s.removed.length} removed from CAD`,
      s.relinked.length ? `${s.relinked.length} re-linked` : null,
      s.restored.length ? `${s.restored.length} back in CAD` : null,
    ].filter(Boolean);
    const warning = s.unknownMachines.length
      ? ` Unknown machines in Onshape: ${s.unknownMachines.join(", ")}.`
      : "";
    return { message: `BOM updated: ${parts.join(", ")} (${s.calls} Onshape calls).${warning}` };
  } catch (err) {
    if (err instanceof OnshapeError) return { error: err.message };
    throw err;
  }
}

// Bulk edit and Kanban moves: the same changes on many parts, one history batch.
export async function updateParts(partIds: string[], changes: unknown): Promise<ActionResult> {
  const member = await requireMember();
  if (!partIds.length || partIds.some((id) => !isUuid(id))) return { error: "Unknown part." };
  const parsed = partChangesSchema.safeParse(changes);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  await applyPartChanges(partIds, parsed.data, { memberId: member.id, via: "ui" });
  revalidatePath("/robots", "layout");
  return {};
}
