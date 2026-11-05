"use server";

import { requireMember } from "@/lib/auth";
import { markSeen } from "@/lib/data/seen";

// The tracked pages' keys (src/lib/seen.ts); anything else is ignored.
const PAGE = /^(fab:[0-9a-f-]{36}|(print|factory):[0-9a-f-]{36}:[\w-]+|cots:(released|order))$/;

// Opening a tracked page: its new parts stop glowing in the side panel and on the home boxes.
export async function markPageSeen(page: string) {
  const member = await requireMember();
  if (!PAGE.test(page)) return;
  await markSeen(member.id, page);
}
