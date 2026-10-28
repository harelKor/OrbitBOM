"use server";

import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireCapability } from "@/lib/mode";
import { isUuid } from "@/lib/uuid";

// X on a recent action: hides it for this member.
export async function dismissAction(visitId: string) {
  const member = await requireCapability("work");
  if (!isUuid(visitId)) return;
  await db.insert(schema.dismissedActions).values({ memberId: member.id, visitId }).onConflictDoNothing();
  revalidatePath("/robots", "layout");
}
