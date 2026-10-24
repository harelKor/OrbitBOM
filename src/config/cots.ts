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
  { name: "In Stock", color: "#04ff00" },
] as const;

export type CotsStatusName = (typeof COTS_STATUSES)[number]["name"];

export const COTS_DEFAULT_STATUS: CotsStatusName = "Not Started";
export const COTS_RELEASED: CotsStatusName = "Released";
export const COTS_ORDERED: CotsStatusName = "In Order List";
export const COTS_IN_STOCK: CotsStatusName = "In Stock";
// A part stays in the COTS page's In Stock sections this long after it arrived (or until its X).
export const IN_STOCK_SHOWN_DAYS = 7;
// The statuses the Order List page works through, in its status button.
export const ORDER_STATUSES: CotsStatusName[] = ["In Order List", "Seen", "In Route", "In Stock"];

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

// The COTS page's filter boxes. `image` is the box's thumbnail under /public (Harel sends
// pictures later; until then the box shows a placeholder). `match` guesses a part's category
// from its name and material when nobody set one.
export const COTS_CATEGORIES = [
  { id: "motion", label: "Gears / Pulleys / Sprockets", image: null, match: /gear|pulley|sprocket|\bhub\b/i },
  { id: "belts", label: "Belts", image: null, match: /\bbelts?\b|htd|gt2|timing/i },
  { id: "motors", label: "Motors", image: null, match: /motor|\bneo\b|vortex|falcon|kraken|\bcim\b|\b775\b|minion|\bbag\b/i },
  { id: "wheels", label: "Wheels", image: null, match: /wheel|omni|mecanum|colson|traction|compliant|stealth|tread/i },
  { id: "round-tubes", label: "Round tubes", image: null, match: /round\s*tube|\btube\b.*\bod\b|\bod\b.*\btube\b|\bpipe\b/i },
  { id: "square-tubes", label: "Square tubes", image: null, match: /(box|square|rect\w*)\s*tube|\btube\b.*\d+\s*x\s*\d+|\d+\s*x\s*\d+.*\btube\b/i },
  { id: "polycarbonate", label: "Polycarbonate plates", image: null, match: /polycarb|lexan|\bpc\b/i },
  { id: "aluminum-plates", label: "Aluminum plates", image: null, match: /alumin\w*.*(plate|sheet)|(plate|sheet).*alumin|\b(6061|5052|7075)\b.*(plate|sheet)/i },
  { id: "other", label: "Other", image: null, match: null },
] as const satisfies readonly { id: string; label: string; image: string | null; match: RegExp | null }[];

export type CotsCategoryId = (typeof COTS_CATEGORIES)[number]["id"];

export const isCotsCategory = (id: string): id is CotsCategoryId => COTS_CATEGORIES.some((c) => c.id === id);

// Prices are kept in US dollars; the card's ₪ button shows them in shekels at this rate.
export const ILS_PER_USD = 3.7;
