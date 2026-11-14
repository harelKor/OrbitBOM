import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { computeStatus } from "@/lib/status";
import { categoryOf } from "@/lib/inventory/categories";
import { searchRank } from "@/lib/inventory/searchWords";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { imageUrl } from "@/lib/storage/r2";
import { cachedQuery } from "./cache";
import { listCategories } from "./categories";
import { itemThumbs } from "./inventory";

const { parts, systems, robots, inventoryItems } = schema;

// How many results each section and the whole dropdown show.
const PER_SECTION = 6;
const MAX_SECTIONS = 8;

export type SearchPart = { id: string; name: string; partNumber: string | null; status: string; thumbUrl: string | null };
export type SearchItem = { id: string; name: string; inStock: number; thumbUrl: string | null };
export type SearchResults = {
  bom: { robotId: string; robotName: string; systemId: string; systemName: string; parts: SearchPart[]; more: number }[];
  inventory: { category: string; label: string; items: SearchItem[]; more: number }[];
};

// Groups ranked hits into sections, best section first, each cut to PER_SECTION.
function sections<T extends { rank: number }>(hits: T[], keyOf: (h: T) => string) {
  const by = new Map<string, T[]>();
  for (const h of hits.sort((a, b) => b.rank - a.rank)) by.set(keyOf(h), [...(by.get(keyOf(h)) ?? []), h]);
  return [...by.values()].sort((a, b) => b[0].rank - a[0].rank || b.length - a.length).slice(0, MAX_SECTIONS);
}

// The top bar's global search (Harel, 2026-11-04): every part on an active robot's BOM, by
// system, then every inventory item, by category. Matches anywhere in the name, part number,
// material or (items) aliases and specs, the way matchesSearch does everywhere else.
export async function globalSearch(q: string): Promise<SearchResults> {
  // Both lists come from the server's memory until a part, system, robot or item changes (one
  // search per keystroke read every part and item from Supabase before, 2026-11-14).
  const [partRows, itemRows, categories] = await Promise.all([
    cachedQuery(
      db
        .select({
          part: {
            id: parts.id,
            displayName: parts.displayName,
            onshapeName: parts.onshapeName,
            partNumber: parts.partNumber,
            material: parts.material,
            thumbnailRev: parts.thumbnailRev,
            classification: parts.classification,
            quantity: parts.quantity,
            designState: parts.designState,
            preProcess: parts.preProcess,
            process1: parts.process1,
            process2: parts.process2,
            donePreprocess: parts.donePreprocess,
            doneProcess1: parts.doneProcess1,
            doneProcess2: parts.doneProcess2,
          },
          systemId: systems.id,
          systemName: systems.name,
          robotId: robots.id,
          robotName: robots.name,
        })
        .from(parts)
        .innerJoin(systems, eq(systems.id, parts.systemId))
        .innerJoin(robots, eq(robots.id, systems.robotId))
        .where(and(isNull(parts.removedFromCadAt), eq(robots.archived, false))),
      ["parts", "systems", "robots"],
    ),
    cachedQuery(
      db
        .select({ id: inventoryItems.id, name: inventoryItems.name, category: inventoryItems.category, imagePath: inventoryItems.imagePath, inStock: inventoryItems.inStock, aliases: inventoryItems.aliases, specs: inventoryItems.specs })
        .from(inventoryItems),
      ["inventory_items"],
    ),
    listCategories(),
  ]);

  const partHits = partRows
    .map((r) => {
      const name = r.part.displayName ?? r.part.onshapeName ?? "Unnamed part";
      const rank = Math.max(searchRank(name, q), searchRank([name, r.part.onshapeName, r.part.partNumber, r.part.material].filter(Boolean).join(" "), q) && 1);
      return { ...r, name, rank };
    })
    .filter((h) => h.rank > 0);
  const itemHits = itemRows
    .map((i) => {
      const rank = Math.max(searchRank(i.name, q), searchRank([i.name, ...i.aliases, ...Object.values(i.specs ?? {})].join(" "), q) && 1);
      return { ...i, cat: categoryOf(i, categories), rank };
    })
    .filter((h) => h.rank > 0);

  const bomSections = sections(partHits, (h) => h.systemId);
  const itemSections = sections(itemHits, (h) => h.cat);
  const shownParts = bomSections.flatMap((s) => s.slice(0, PER_SECTION));
  const shownItems = itemSections.flatMap((s) => s.slice(0, PER_SECTION));
  const [partThumbs, itemPics] = await Promise.all([
    Promise.all(shownParts.map(async (h) => [h.part.id, h.part.thumbnailRev ? await imageUrl(thumbKey(h.part.id, h.part.thumbnailRev)) : null] as const)).then((e) => new Map(e)),
    itemThumbs(shownItems, categories),
  ]);
  const label = new Map(categories.map((c) => [c.id, c.label]));

  return {
    bom: bomSections.map((list) => ({
      robotId: list[0].robotId,
      robotName: list[0].robotName,
      systemId: list[0].systemId,
      systemName: list[0].systemName,
      parts: list.slice(0, PER_SECTION).map((h) => ({ id: h.part.id, name: h.name, partNumber: h.part.partNumber, status: computeStatus(h.part), thumbUrl: partThumbs.get(h.part.id) ?? null })),
      more: Math.max(0, list.length - PER_SECTION),
    })),
    inventory: itemSections.map((list) => ({
      category: list[0].cat,
      label: label.get(list[0].cat) ?? "Other",
      items: list.slice(0, PER_SECTION).map((h) => ({ id: h.id, name: h.name, inStock: h.inStock, thumbUrl: itemPics.get(h.id) ?? null })),
      more: Math.max(0, list.length - PER_SECTION),
    })),
  };
}
