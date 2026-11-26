import "server-only";
import { db, schema } from "@/db";
import { cachedQuery } from "./cache";

// The team's changed material colours, by category (the rest use the defaults).
export async function listMaterialColors(): Promise<Record<string, string>> {
  // Read by the layout on every render and save: kept until a colour changes (migration 0112).
  const rows = await cachedQuery(db.select({ category: schema.materialColors.category, color: schema.materialColors.color }).from(schema.materialColors), ["material_colors"]);
  return Object.fromEntries(rows.map((r) => [r.category, r.color]));
}
