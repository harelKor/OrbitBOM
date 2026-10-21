import "server-only";
import { cookies } from "next/headers";
import { VISIT_COOKIE, decodeVisit } from "@/components/shell/visit";

// The page visit the current request comes from, or null outside a page (cron, MCP).
export async function currentVisit(): Promise<{ id: string; page: string } | null> {
  try {
    return decodeVisit((await cookies()).get(VISIT_COOKIE)?.value);
  } catch {
    return null;
  }
}
