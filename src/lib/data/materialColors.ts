import "server-only";
import { db, schema } from "@/db";

// The team's changed material colours, by category (the rest use the defaults).
export async function listMaterialColors(): Promise<Record<string, string>> {
  const rows = await db.select({ category: schema.materialColors.category, color: schema.materialColors.color }).from(schema.materialColors);
  return Object.fromEntries(rows.map((r) => [r.category, r.color]));
}
