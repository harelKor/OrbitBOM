// Which inventory item a BOM part probably is, most certain first: the same Onshape library part,
// the same product page, then the same name (or a name the item was linked under before). A
// fastener only matches the same thread, length and head (fastener.ts): McMaster's configurable
// screws are one Onshape part for every length (audit, 2026-11-20).

import { fastenerMatch, itemFastener, partFastener } from "./fastener";

export type MatchItem = { id: string; name: string; onshapeKey: string | null; aliases: string[]; cotsLinks: { url: string }[] };
export type MatchPart = {
  displayName: string | null;
  onshapeName: string | null;
  sourceDid?: string | null;
  sourceEid?: string | null;
  onshapePartId?: string | null;
  cotsLinks?: { url: string }[] | null;
};
export type MatchReason = "onshape" | "link" | "name";

export const onshapeKeyOf = (p: Pick<MatchPart, "sourceDid" | "sourceEid" | "onshapePartId">) =>
  p.sourceDid && p.sourceEid && p.onshapePartId ? `${p.sourceDid}:${p.sourceEid}:${p.onshapePartId}` : null;

export const normName = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function normUrl(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export function suggestItem(part: MatchPart, items: MatchItem[]): { itemId: string; reason: MatchReason } | null {
  return itemMatcher(items)(part);
}

// suggestItem for many parts against the same items: the items are indexed once, so each part
// is a few lookups, not a scan of every item. The first item in `items` order wins, as before.
export function itemMatcher(items: MatchItem[]) {
  const first = <K>(map: Map<K, number>, key: K, i: number) => {
    if (!map.has(key)) map.set(key, i);
  };
  const byKey = new Map<string, number>();
  const byUrl = new Map<string, number>();
  const byName = new Map<string, number>();
  items.forEach((item, i) => {
    if (item.onshapeKey) first(byKey, item.onshapeKey, i);
    for (const l of item.cotsLinks) first(byUrl, normUrl(l.url), i);
    for (const n of [item.name, ...item.aliases]) first(byName, normName(n), i);
  });
  const best = (map: Map<string, number>, keys: Iterable<string>) => {
    let at = Infinity;
    for (const k of keys) at = Math.min(at, map.get(k) ?? Infinity);
    return at === Infinity ? null : items[at];
  };
  return (part: MatchPart): { itemId: string; reason: MatchReason } | null => {
    const screw = partFastener([part.displayName, part.onshapeName]);
    const fits = (item: MatchItem | null) => !!item && fastenerMatch(screw, itemFastener(item)).result !== "clash";
    const key = onshapeKeyOf(part);
    const byOnshape = key ? best(byKey, [key]) : null;
    if (fits(byOnshape)) return { itemId: byOnshape!.id, reason: "onshape" };
    const byLink = best(byUrl, (part.cotsLinks ?? []).map((l) => normUrl(l.url)));
    if (fits(byLink)) return { itemId: byLink!.id, reason: "link" };
    const byNameHit = best(byName, [normName(part.displayName), normName(part.onshapeName)].filter(Boolean));
    if (fits(byNameHit)) return { itemId: byNameHit!.id, reason: "name" };
    return null;
  };
}
