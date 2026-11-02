// Suggest's inventory search by part name (Harel, 2026-11-02). Parts the team makes are named
// with a part number ("1690-26-411-01A", "1691-26-431"); COTS and library parts keep a
// descriptive name ("Kraken X60", "18T HTD Pulley", "688ZZ Bearing", "M5x16 SHCS"). A part whose
// name says more than its part number is searched for in the inventory, and an item that clearly
// matches is suggested as its link. An item outside Raw Stock also makes the part COTS, with the
// item's category, product links and price. Everything waits in To Review.

import { bestLinks, type LinkItem, type LinkPart } from "@/lib/inventory/linkScore";
import type { CotsLink } from "@/db/schema";
import type { PartChanges } from "@/lib/parts/changes";

// A team part number with optional prefix and suffix: 1690-26-411, 1690-26-411-01A, P1691-26-431B.
const PART_NUMBER = /\b[a-z]{0,3}\d{3,4}-\d{2}-\d{3,4}(?:[-_.]?[a-z0-9]{1,4})*\b/gi;
// What Onshape and designers add to a name that says nothing about the product.
const NOISE = /<\d+>|\(\d+\)|\[\d+\]|\b(?:part|body|copy|default|rev|ver|v)\s*\d*\b|\bpart\b|\bcopy\b/gi;

// The name with its part number and Onshape's numbering taken out.
export function descriptivePart(name: string | null | undefined): string {
  return (name ?? "").replace(PART_NUMBER, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim();
}

// True when the name has words beyond a part number (a word with two letters or more).
export function isDescriptiveName(name: string | null | undefined): boolean {
  return /[a-z]{2}/i.test(descriptivePart(name));
}

export type NameMatchPart = {
  id: string;
  displayName: string | null;
  onshapeName: string | null;
  cotsLinks: CotsLink[];
  unitPrice: number | null;
};
export type NameMatchItem = LinkItem & {
  group: string | null; // its category's group; "consumables" is Raw Stock
  categoryId: string | null;
  cotsLinks: CotsLink[];
  price: number | null;
};
export type NameMatch = { item: NameMatchItem; why: string[] };

// Each descriptively named part's clearly best item, matched on its name with the part number
// left out. `skip` leaves out pairs someone rejected before.
export function matchByName(parts: NameMatchPart[], items: NameMatchItem[], skip: (partId: string, itemId: string) => boolean = () => false) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const linkParts: LinkPart[] = parts.flatMap((p) => {
    const name = p.displayName ?? p.onshapeName;
    if (!isDescriptiveName(name)) return [];
    const names = [...new Set([p.displayName, p.onshapeName].filter(isDescriptiveName).map((n) => descriptivePart(n)))];
    return [{ id: p.id, names, onshapeKey: null, docKey: null, urls: [], thumbHash: null }];
  });
  const out = new Map<string, NameMatch>();
  for (const l of bestLinks(linkParts, items, skip)) out.set(l.partId, { item: byId.get(l.itemId)!, why: l.why });
  return out;
}

// The setup a name match suggests: the link, and for an item outside Raw Stock the COTS type,
// category, links and price (links and price only where the part has none), with the material
// and processes an in-house guess left on it cleared. Raw Stock items are left to the rules, which
// link them as the part's material. Null when nothing would change.
export function nameMatchSetup(
  part: NameMatchPart & {
    classification: string;
    inventoryItemId?: string | null;
    material: string | null;
    preProcess: string | null;
    process1: string | null;
    process2: string | null;
  },
  match: NameMatch,
): { changes: PartChanges; reason: string } | null {
  const { item } = match;
  if (item.group === "consumables") return null;
  const changes: PartChanges = {};
  if (part.inventoryItemId !== item.id) changes.inventoryItemId = item.id;
  if (part.classification !== "cots") changes.classification = "cots";
  if (item.categoryId) changes.cotsCategory = item.categoryId;
  if (!part.cotsLinks.length && item.cotsLinks.length) changes.cotsLinks = item.cotsLinks;
  if (part.unitPrice == null && item.price != null) changes.unitPrice = item.price;
  for (const f of ["material", "preProcess", "process1", "process2"] as const) if (part[f]) changes[f] = null;
  if (!changes.inventoryItemId && !changes.classification) return null;
  const name = descriptivePart(part.displayName ?? part.onshapeName);
  return { changes, reason: `"${name}" is the inventory item ${item.name} (${match.why.join(", ")}), so COTS` };
}
