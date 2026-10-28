import "server-only";
import { cookies } from "next/headers";
import { MODE_COOKIE, type Mode } from "@/components/shell/mode";
import { getMember } from "@/lib/auth";

// View | Edit is a screen mode, not a permission: server actions still check membership.
// The toggle's cookie wins; without one, Build Team starts in View and everyone else in Edit.
export async function getMode(): Promise<Mode> {
  const picked = (await cookies()).get(MODE_COOKIE)?.value;
  if (picked === "view" || picked === "edit") return picked;
  return (await getMember())?.team === "build" ? "view" : "edit";
}

export async function isEditMode() {
  return (await getMode()) === "edit";
}
