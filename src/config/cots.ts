// COTS (bought) parts: their own statuses, the COTS page's filter boxes and the price
// currencies. Edit here; there is no settings UI.

// A COTS part's statuses, in order: from the design being released to the part on the shelf.
// They live apart from the made-part statuses in statuses.ts; computeStatus picks these for COTS.
export const COTS_STATUSES = [
  { name: "Not Started", color: "#cbd5e1" },
  { name: "Released", color: "#00aaff" },
  { name: "In Order List", color: "#f59e0b" },
  { name: "Seen", color: "#fde047" },
  { name: "In Route", color: "#a855f7" },
  { name: "Arrived", color: "#14b8a6" },
  { name: "In Stock", color: "#04ff00" },
] as const;

export type CotsStatusName = (typeof COTS_STATUSES)[number]["name"];

export const COTS_DEFAULT_STATUS: CotsStatusName = "Not Started";
export const COTS_RELEASED: CotsStatusName = "Released";
export const COTS_ORDERED: CotsStatusName = "In Order List";
export const COTS_IN_ROUTE: CotsStatusName = "In Route";
// A delivery date means the order was placed: parts still at these move on to In Route (Harel, 2026-11-05).
export const BEFORE_IN_ROUTE: CotsStatusName[] = ["In Order List", "Seen"];
export const COTS_ARRIVED: CotsStatusName = "Arrived";
export const COTS_IN_STOCK: CotsStatusName = "In Stock";
// A part stays in the COTS page's In Stock sections this long after it arrived (or until its X).
export const IN_STOCK_SHOWN_DAYS = 7;
// The statuses the Order List page works through, in its status button.
export const ORDER_STATUSES: CotsStatusName[] = ["In Order List", "Seen", "In Route", "Arrived", "In Stock"];

const byName = new Map<string, (typeof COTS_STATUSES)[number]>(COTS_STATUSES.map((s) => [s.name, s]));

export const getCotsStatus = (name: string) => byName.get(name);
export const isCotsStatusName = (name: string): name is CotsStatusName => byName.has(name);

// Made-part statuses a COTS part may carry from before COTS had its own (or from Bulk edit).
const LEGACY: Record<string, CotsStatusName> = { "Ready to Fab": "Released", Ordered: "In Order List" };

export function cotsStatusOf(designState: string | null): CotsStatusName {
  if (!designState) return COTS_DEFAULT_STATUS;
  if (isCotsStatusName(designState)) return designState;
  return LEGACY[designState] ?? COTS_DEFAULT_STATUS;
}

// The COTS page's filter boxes are the inventory categories and their groups (config/inventory.ts,
// inventory_categories) since 2026-10-27; 0032 moved the old box ids over.

// Prices are kept in US dollars; the card's ₪ button shows them in shekels at this rate.
export const ILS_PER_USD = 3.7;
