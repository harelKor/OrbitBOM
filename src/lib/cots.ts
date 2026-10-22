// COTS parts on the COTS page: which filter box a part belongs in, the same part across a robot's
// systems shown as one card, and prices.

import { COTS_CATEGORIES, isCotsCategory, type CotsCategoryId } from "@/config/cots";
import { fanOutChanges } from "@/lib/merges/merge";
import type { PartChanges } from "@/lib/parts/changes";

type Named = { displayName: string | null; onshapeName: string | null; material: string | null; cotsCategory: string | null };

// The part's filter box: the one set on it, else a guess from its name and material.
export function cotsCategoryOf(part: Named): CotsCategoryId {
  if (part.cotsCategory && isCotsCategory(part.cotsCategory)) return part.cotsCategory;
  const text = [part.displayName, part.onshapeName, part.material].filter(Boolean).join(" ");
  return COTS_CATEGORIES.find((c) => c.match?.test(text))?.id ?? "other";
}

type Identity = Named & {
  id: string;
  sourceDid?: string | null;
  sourceEid?: string | null;
  onshapePartId?: string | null;
};

// The same COTS part in different systems: the same Onshape part (one library part inserted in
// several places) or the same name. Each group keeps the order the parts came in.
export function groupSameCots<T extends Identity>(parts: T[]): T[][] {
  const parent = parts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const firstWith = new Map<string, number>();
  parts.forEach((p, i) => {
    const name = (p.displayName ?? p.onshapeName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const keys = [
      p.sourceDid && p.sourceEid && p.onshapePartId ? `os:${p.sourceDid}:${p.sourceEid}:${p.onshapePartId}` : null,
      name ? `name:${name}` : null,
    ];
    for (const key of keys) {
      if (!key) continue;
      const j = firstWith.get(key);
      if (j === undefined) firstWith.set(key, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, T[]>();
  parts.forEach((p, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), p]));
  return [...groups.values()];
}

// An edit of a grouped card, per member: the stock count is spread over the members up to each
// one's quantity, a rename reaches every member, and the rest is the same for all.
export function spreadCotsChanges(members: { id: string; quantity: number }[], changes: PartChanges) {
  const { perMember } = fanOutChanges(members, changes);
  if (changes.displayName === undefined) return perMember;
  return members.map((m) => ({ id: m.id, changes: { ...perMember.find((pm) => pm.id === m.id)?.changes, displayName: changes.displayName } }));
}

// What a part costs: the average price of one at the quantity needed, times the quantity.
export const cotsTotal = (p: { unitPrice: number | null; quantity: number }) => (p.unitPrice == null ? null : p.unitPrice * Math.max(p.quantity, 1));

// A link's label: the site's name, else its host.
export function siteOf(link: { url: string; site?: string }) {
  if (link.site) return link.site;
  try {
    return new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    return link.url;
  }
}
