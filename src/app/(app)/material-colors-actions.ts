"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { MATERIAL_COLOR_GROUPS } from "@/config/materialColors";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";

// Sets a material category's 3D colour for the whole team; null goes back to the default.
export async function setMaterialColor(category: string, color: string | null): Promise<{ error?: string }> {
  const member = await requireMember();
  if (!MATERIAL_COLOR_GROUPS.includes(category)) return { error: "Unknown material." };
  if (color === null) {
    await db.delete(schema.materialColors).where(eq(schema.materialColors.category, category));
  } else {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return { error: "Pick a colour." };
    const row = { color: color.toLowerCase(), updatedBy: member.id, updatedAt: new Date() };
    await db
      .insert(schema.materialColors)
      .values({ category, ...row })
      .onConflictDoUpdate({ target: schema.materialColors.category, set: row });
  }
  revalidatePath("/", "layout");
  return {};
}
