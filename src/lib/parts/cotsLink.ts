import { COTS_RELEASED, ORDER_STATUSES, cotsStatusOf } from "@/config/cots";

// Only inventory-backed parts live in the COTS page's Released and Order List (Harel, 2026-11-01):
// a COTS part needs its inventory item before it gets one of these statuses, and keeps it while there.
export const COTS_LINK_REQUIRED = "COTS parts must be linked to an Inventory item before releasing to COTS.";
export const COTS_LINK_KEPT = "COTS parts in Released or the Order List must stay linked to an Inventory item.";

const NEEDS_ITEM = new Set<string>([COTS_RELEASED, ...ORDER_STATUSES]);

// A COTS status (or a legacy made-part name one maps to) that needs an inventory item.
export const statusNeedsItem = (status: string) => NEEDS_ITEM.has(cotsStatusOf(status));

type Part = { classification: string; inventoryItemId: string | null; designState: string | null };
type Changes = { status?: string; inventoryItemId?: string | null; classification?: string };

// Why `changes` would leave a COTS part in Released or the Order List with no inventory item, or null.
export function cotsLinkDenied(part: Part, changes: Changes): string | null {
  if (changes.status === undefined && changes.inventoryItemId !== null) return null;
  if ((changes.classification ?? part.classification) !== "cots") return null;
  const item = changes.inventoryItemId !== undefined ? changes.inventoryItemId : part.inventoryItemId;
  if (item) return null;
  if (changes.status !== undefined) return statusNeedsItem(changes.status) ? COTS_LINK_REQUIRED : null;
  return statusNeedsItem(part.designState ?? "") ? COTS_LINK_KEPT : null;
}
