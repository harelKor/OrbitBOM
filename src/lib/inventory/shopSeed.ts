import "server-only";
import { eq } from "drizzle-orm";
import { COTS_ORDERED } from "@/config/cots";
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import { vendorOfUrl } from "@/config/vendors";
import { db, schema } from "@/db";
import type { CotsLink } from "@/db/schema";
import { listCategories } from "@/lib/data/categories";
import { pushItemToCards } from "./cotsSync";
import { recordItemChanges } from "./history";
import { readProduct, saveProductPhoto, toUsd } from "./product";
import { searchProducts } from "./search";
import seedRows from "./shopSeed.json";

// The team's shop spreadsheet (Harel, 2026-10-27), parsed once into shopSeed.json: one row per
// item with its category, specs, stock, season need and condition; `ordered` marks rows the sheet
// says are on order; `url` is the row's product link, `search` a store search for COTS rows that
// only name the product. It runs in production from /api/cron/inventory-seed, in two steps that
// are both safe to repeat: import (items, conditions, Order List cards) and enrich (product
// links, prices and pictures, a few at a time). Progress is kept in onshape_cache under STATE.

export type SeedItem = {
  key: string;
  name: string;
  category: string;
  specs: Record<string, string>;
  inStock: number;
  seasonNeed: number | null;
  condition?: string;
  ordered?: boolean;
  url?: string;
  search?: { q: string; must: string[]; not?: string[]; vendor?: string };
};

const {
  inventoryItems,
  inventoryConditions,
  inventoryCategories,
  onshapeCache,
  parts,
} = schema;
const STATE = "inventory-seed:shop-2026-10";
const CONDITIONS = [
  { label: "New", color: "#10b981" },
  { label: "3D Printed", color: "#8b5cf6" },
  { label: "Used / Worn", color: "#f59e0b" },
];
const ctx = { memberId: null, via: "sync" as const };

type State = {
  items: Record<string, string>;
  enriched: Record<string, "linked" | "photo" | "none" | "error">;
  cards: number;
};

const SEED = seedRows as SeedItem[];
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function readState(): Promise<State> {
  const [row] = await db
    .select({ payload: onshapeCache.payload })
    .from(onshapeCache)
    .where(eq(onshapeCache.key, STATE));
  const p = (row?.payload ?? {}) as Partial<State>;
  return {
    items: p.items ?? {},
    enriched: p.enriched ?? {},
    cards: p.cards ?? 0,
  };
}

async function writeState(state: State, exec: Tx | typeof db = db) {
  await exec
    .insert(onshapeCache)
    .values({ key: STATE, payload: state })
    .onConflictDoUpdate({
      target: onshapeCache.key,
      set: { payload: state, fetchedAt: new Date() },
    });
}

// Step 1: every seed row not imported yet becomes an item, with its counted stock. A short row
// the sheet marks as ordered also gets its General restock card, straight on the Order List.
export async function importShopSeed() {
  const seed = SEED;
  const state = await readState();
  const todo = seed.filter((s) => !state.items[s.key]);
  if (!todo.length) return { imported: 0, cards: 0, total: seed.length };
  let cards = 0;
  await db.transaction(async (tx) => {
    // The categories the sheet uses, in case this team's table predates them.
    const have = new Set((await listCategories(tx)).map((c) => c.id));
    const missingCats = DEFAULT_CATEGORIES.filter(
      (c) => !have.has(c.id) && seed.some((s) => s.category === c.id),
    );
    for (const [n, c] of missingCats.entries())
      await tx
        .insert(inventoryCategories)
        .values({
          id: c.id,
          label: c.label,
          noun: c.noun,
          group: c.group,
          sheet: !!c.sheet,
          position: have.size + n,
          fields: c.fields,
        })
        .onConflictDoNothing();
    await tx
      .insert(inventoryConditions)
      .values(CONDITIONS)
      .onConflictDoNothing();
    const conditions = new Map(
      (await tx.select().from(inventoryConditions)).map((c) => [c.label, c.id]),
    );
    const existing = new Map(
      (
        await tx
          .select({
            id: inventoryItems.id,
            name: inventoryItems.name,
            category: inventoryItems.category,
            conditionId: inventoryItems.conditionId,
          })
          .from(inventoryItems)
      ).map((i) => [`${i.name}|${i.category}|${i.conditionId}`, i.id]),
    );

    for (const s of todo) {
      const conditionId = s.condition
        ? (conditions.get(s.condition) ?? null)
        : null;
      // Someone already added it by hand: keep theirs.
      const same = existing.get(`${s.name}|${s.category}|${conditionId}`);
      if (same) {
        state.items[s.key] = same;
        continue;
      }
      const values = {
        name: s.name,
        category: s.category,
        specs: s.specs,
        conditionId,
        seasonNeed: s.seasonNeed,
        inStock: s.inStock,
      };
      const [{ id }] = await tx
        .insert(inventoryItems)
        .values(values)
        .returning({ id: inventoryItems.id });
      await recordItemChanges(tx, id, null, values, ctx);
      if (s.inStock > 0)
        await tx
          .insert(schema.inventoryMoves)
          .values({
            itemId: id,
            delta: s.inStock,
            reason: "counted",
            memberId: null,
            via: "sync",
          });
      state.items[s.key] = id;
      const short =
        s.seasonNeed != null ? Math.ceil(s.seasonNeed - s.inStock) : 0;
      if (s.ordered && short > 0) {
        await tx.insert(parts).values({
          systemId: null,
          robotId: null,
          isManual: true,
          displayName: s.name,
          classification: "cots",
          classSource: "manual",
          inventoryItemId: id,
          cotsCategory: s.category,
          quantity: short,
          restock: true,
          designState: COTS_ORDERED,
        });
        cards++;
      }
    }
    state.cards += cards;
    await writeState(state, tx);
  });
  return { imported: todo.length, cards, total: seed.length };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/["'”″]/g, "")
    .replace(/(\d)\s*(t|mm|in)\b/g, "$1$2")
    .replace(/\s+/g, " ");

type Found = { link: CotsLink; price: number | null; image: string | null };

async function lookUp(s: SeedItem): Promise<Found | null> {
  if (s.url) {
    const link = { url: s.url, site: vendorOfUrl(s.url) };
    try {
      const p = await readProduct(s.url);
      return { link, price: toUsd(p.price, p.currency), image: p.image };
    } catch {
      return { link, price: null, image: null }; // the store wouldn't answer; the link still helps
    }
  }
  if (!s.search) return null;
  const { groups } = await searchProducts(s.search.q);
  const must = s.search.must.map(norm);
  const not = (s.search.not ?? []).map(norm);
  for (const g of groups)
    for (const o of g.offers) {
      const title = norm(o.title);
      if (s.search.vendor && o.vendor !== s.search.vendor) continue;
      if (
        !must.every((w) => title.includes(w)) ||
        not.some((w) => title.includes(w))
      )
        continue;
      return {
        link: { url: o.url, site: o.vendor },
        price: o.price,
        image: o.image ?? g.image,
      };
    }
  return null;
}

// Step 2: product links, prices and pictures for imported rows that have a link or a store
// search, a few at a time until the deadline. A member's own link, price or photo is kept.
export async function enrichShopSeed(deadline: number) {
  const seed = SEED;
  const state = await readState();
  const todo = seed.filter(
    (s) => state.items[s.key] && !state.enriched[s.key] && (s.url || s.search),
  );
  let done = 0;
  for (let i = 0; i < todo.length && Date.now() < deadline - 12_000; i += 4) {
    await Promise.all(
      todo.slice(i, i + 4).map(async (s) => {
        const id = state.items[s.key];
        try {
          const found = await lookUp(s);
          const [item] = await db
            .select()
            .from(inventoryItems)
            .where(eq(inventoryItems.id, id));
          if (!item || !found) {
            state.enriched[s.key] = "none";
            return;
          }
          const values = {
            ...(!item.cotsLinks.length && { cotsLinks: [found.link] }),
            ...(item.price == null &&
              found.price != null && { price: found.price }),
          };
          if (Object.keys(values).length)
            await db.transaction(async (tx) => {
              await tx
                .update(inventoryItems)
                .set(values)
                .where(eq(inventoryItems.id, id));
              await recordItemChanges(tx, id, item, values, ctx);
              await pushItemToCards(tx, id, values);
            });
          let photo = false;
          if (found.image && !item.imagePath) {
            const key = await saveProductPhoto(id, found.image);
            if (key) {
              await db
                .update(inventoryItems)
                .set({ imagePath: key })
                .where(eq(inventoryItems.id, id));
              photo = true;
            }
          }
          state.enriched[s.key] = photo ? "photo" : "linked";
        } catch {
          state.enriched[s.key] = "error";
        }
        done++;
      }),
    );
    await writeState(state);
  }
  const results = Object.values(state.enriched);
  return {
    enrichedNow: done,
    remaining: todo.length - done,
    linked: results.filter((r) => r === "linked" || r === "photo").length,
    photos: results.filter((r) => r === "photo").length,
    notFound: results.filter((r) => r === "none").length,
    errors: results.filter((r) => r === "error").length,
  };
}
