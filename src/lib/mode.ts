import "server-only";
import { cookies } from "next/headers";
import { MODE_COOKIE, type Mode } from "@/components/shell/mode";

// View | Edit is a screen mode, not a permission: server actions still check membership.
// Edit is the default until someone picks View.
export async function getMode(): Promise<Mode> {
  return (await cookies()).get(MODE_COOKIE)?.value === "view" ? "view" : "edit";
}

export async function isEditMode() {
  return (await getMode()) === "edit";
}
