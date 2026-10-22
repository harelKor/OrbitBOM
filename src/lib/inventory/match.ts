// Which inventory item a BOM part probably is, most certain first: the same Onshape library part,
// the same product page, then the same name (or a name the item was linked under before).

export type MatchItem = { id: string; name: string; onshapeKey: string | null; aliases: string[]; vendorUrl: string | null };
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

function normUrl(url: string) {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export function suggestItem(part: MatchPart, items: MatchItem[]): { itemId: string; reason: MatchReason } | null {
  const key = onshapeKeyOf(part);
  if (key) {
    const hit = items.find((i) => i.onshapeKey === key);
    if (hit) return { itemId: hit.id, reason: "onshape" };
  }
  const urls = new Set((part.cotsLinks ?? []).map((l) => normUrl(l.url)));
  if (urls.size) {
    const hit = items.find((i) => i.vendorUrl && urls.has(normUrl(i.vendorUrl)));
    if (hit) return { itemId: hit.id, reason: "link" };
  }
  const names = new Set([normName(part.displayName), normName(part.onshapeName)].filter(Boolean));
  if (names.size) {
    const hit = items.find((i) => [i.name, ...i.aliases].some((n) => names.has(normName(n))));
    if (hit) return { itemId: hit.id, reason: "name" };
  }
  return null;
}
