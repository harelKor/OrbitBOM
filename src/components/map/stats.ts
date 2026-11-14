import type { Place } from "@/lib/inventory/places";
import type { PlaceStats } from "./ShopMap";

type StatItem = { id: string; name: string; category: string; place: string | null; short: boolean };
type StatCategory = { id: string; label: string; imageUrl?: string | null };

// What the map shows for each place: item counts, the short ones, and the categories (by how
// many items) — a zone's count includes its drawers'.
export function placeStats(items: StatItem[], places: Place[], categories: StatCategory[]): PlaceStats {
  const byId = new Map(places.map((p) => [p.id, p]));
  const cat = new Map(categories.map((c) => [c.id, c]));
  const out: PlaceStats = new Map();
  const cats = new Map<string, Map<string, number>>();
  const add = (placeId: string, i: StatItem) => {
    let st = out.get(placeId);
    if (!st) out.set(placeId, (st = { count: 0, short: 0, categories: [], items: [] }));
    st.count++;
    if (i.short) st.short++;
    st.items.push({ id: i.id, name: i.name });
    let c = cats.get(placeId);
    if (!c) cats.set(placeId, (c = new Map()));
    c.set(i.category, (c.get(i.category) ?? 0) + 1);
  };
  for (const i of items) {
    const p = i.place ? byId.get(i.place) : undefined;
    if (!p) continue;
    add(p.id, i);
    if (p.parentId && byId.has(p.parentId)) add(p.parentId, i);
  }
  for (const [id, st] of out) {
    st.categories = [...(cats.get(id) ?? [])]
      .sort((a, b) => b[1] - a[1])
      .map(([cid, count]) => ({ id: cid, label: cat.get(cid)?.label ?? cid, imageUrl: cat.get(cid)?.imageUrl ?? null, count }));
    st.items.sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}
