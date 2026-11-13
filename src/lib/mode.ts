import "server-only";
import { inArray } from "drizzle-orm";
import { cookies } from "next/headers";
import { can, effectiveMode, isSpecReset, MODE_COOKIE, statusDenied, type Capability, type Mode } from "@/components/shell/mode";
import { areaOf } from "@/config/machines";
import { db, schema } from "@/db";
import { getMember, requireMember, type Member } from "@/lib/auth";
import { cotsLinkDenied } from "@/lib/parts/cotsLink";
import { fabSetupDenied } from "@/lib/parts/fabSetup";
import { isUuid } from "@/lib/uuid";

// The signed-in member's effective mode: an admin's Edit | CAD | Build pick (Edit without one),
// else their team, else "none". Server actions check it too, so a preview is the real thing.
export async function getMode(): Promise<Mode> {
  const member = await getMember();
  if (!member) return "none";
  return effectiveMode(member, (await cookies()).get(MODE_COOKIE)?.value);
}

export async function isEditMode() {
  return (await getMode()) === "edit";
}

export async function hasCapability(cap: Capability) {
  return can(await getMode(), cap);
}

// For server actions: the member, if their mode allows `cap`; otherwise the action fails.
export async function requireCapability(cap: Capability): Promise<Member> {
  const member = await requireMember();
  if (!can(effectiveMode(member, (await cookies()).get(MODE_COOKIE)?.value), cap)) throw new Error(DENIED[cap]);
  return member;
}

export const DENIED: Record<Capability, string> = {
  work: "Pick a team on your profile (Build or CAD) to make changes.",
  draw: "Only the CAD Team can make drawings.",
  review: "Only the CAD Team can review parts.",
  sync: "Only the CAD Team can sync from Onshape.",
  classify: "Only the CAD Team can change a part's type (COTS, In-House or Undefined).",
  shape: "Only the CAD Team can bulk edit, merge or add parts.",
  instruct: "Only the CAD Team can write assembly steps.",
  manage: "Only an admin in Edit mode can do this.",
};

// For server actions that set a status: why the member's mode can't give these parts `status`
// (statusDenied in mode.ts), or null when it can. COTS parts follow their own rule, and in every
// mode a COTS part needs its inventory item for Released and the Order List (cotsLinkDenied), and a
// made part its machine and material for Released (fabSetupDenied).
export async function statusChangeDenied(
  partIds: string[],
  changes: { status?: string; note?: string | null; inventoryItemId?: string | null; classification?: string; material?: string | null; preProcess?: string | null; process1?: string | null; process2?: string | null },
): Promise<string | null> {
  if (changes.status === undefined && changes.inventoryItemId !== null) return null;
  const ids = partIds.filter(isUuid);
  const rows = ids.length
    ? await db
        .select({
          classification: schema.parts.classification,
          inventoryItemId: schema.parts.inventoryItemId,
          designState: schema.parts.designState,
          material: schema.parts.material,
          preProcess: schema.parts.preProcess,
          process1: schema.parts.process1,
          process2: schema.parts.process2,
        })
        .from(schema.parts)
        .where(inArray(schema.parts.id, ids))
    : [];
  for (const r of rows) {
    const denied = cotsLinkDenied(r, changes) ?? fabSetupDenied(r, changes);
    if (denied) return denied;
  }
  if (!changes.status) return null;
  const mode = await getMode();
  // Each kind of part once: COTS, made at a Factory Fab factory, on a team printer, or in the shop.
  const kinds = new Map(
    rows.map((r) => {
      const kind = { cots: r.classification === "cots", factory: areaOf(r) === "factory", print: areaOf(r) === "print" };
      return [JSON.stringify(kind), kind];
    }),
  );
  if (!kinds.size) kinds.set("", { cots: false, factory: false, print: false });
  for (const kind of kinds.values()) {
    const denied = statusDenied(mode, changes.status, { ...kind, note: changes.note, reset: isSpecReset(changes) });
    if (denied) return denied;
  }
  return null;
}
