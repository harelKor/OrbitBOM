"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { disconnect } from "@/lib/onshape/client";

export async function disconnectOnshape() {
  const member = await requireMember();
  await disconnect(member.id);
  revalidatePath("/profile");
}
