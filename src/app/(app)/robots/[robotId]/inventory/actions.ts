"use server";

import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { SIZE_KEY } from "@/lib/inventory/stock";
import { requireCapability } from "@/lib/mode";
import { isUuid } from "@/lib/uuid";

// The Raw stock planner's piece size for one stock group, kept for the whole team. Merged into the
// column (jsonb ||), so two people choosing for different groups don't overwrite each other.
export async function setRawStockSize(robotId: string, groupKey: string, size: string): Promise<{ error?: string }> {
  await requireCapability("work");
  if (!isUuid(robotId) || !groupKey || groupKey.length > 200 || !SIZE_KEY.test(size) || size[0] === "f") return { error: "That size can't be saved." };
  await db
    .update(schema.robots)
    .set({ rawStockSizes: sql`${schema.robots.rawStockSizes} || ${JSON.stringify({ [groupKey]: size })}::jsonb` })
    .where(eq(schema.robots.id, robotId));
  return {};
}
