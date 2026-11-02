import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  COTS_DEFAULT_STATUS,
  COTS_ORDERED,
  COTS_RELEASED,
  ORDER_STATUSES,
  cotsStatusOf,
} from "@/config/cots";
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import { vendorOfUrl } from "@/config/vendors";
import { db, schema } from "@/db";
import type { CotsLink } from "@/db/schema";
import { listCategories } from "@/lib/data/categories";
import { pushItemToCards } from "./cotsSync";
import { recordItemChanges } from "./history";
import { readProduct, saveProductPhoto, toUsd } from "./product";
import { searchProducts } from "./search";
import cleanupRows from "./shopCleanup.json";
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
  { label: "Printed", color: "#8b5cf6" },
  { label: "Worn", color: "#f59e0b" },
];
const ctx = { memberId: null, via: "sync" as const };

type State = {
  items: Record<string, string>;
  enriched: Record<string, "linked" | "photo" | "none" | "error">;
  cards: number;
  // Round 2 (Harel, 2026-10-28): seed keys whose name and note were cleaned up, and item ids the
  // relink step has tried.
  cleaned?: Record<string, true>;
  relinked?: Record<string, "linked" | "none" | "error">;
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
    cleaned: p.cleaned ?? {},
    relinked: p.relinked ?? {},
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
        await tx.insert(schema.inventoryMoves).values({
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

// Round 2 (Harel, 2026-10-28), also one-off and safe to repeat.

const BACKUP = "inventory-seed:cots-backup-2026-10-28";

// Step 3: empty Released and the Order List. General cards (no system) are deleted, BOM parts go
// back to Not Started. Stock is left as it is. The rows are kept under BACKUP before the first
// change, and the seed items get the short names, notes and conditions in shopCleanup.json (an
// item someone renamed keeps its name, one with a note keeps its note).
export async function cleanupShopSeed() {
  const state = await readState();
  const listed = new Set<string>([COTS_RELEASED, ...ORDER_STATUSES]);
  const cots = (
    await db.select().from(parts).where(eq(parts.classification, "cots"))
  ).filter((p) => listed.has(cotsStatusOf(p.designState)));
  const general = cots.filter((p) => p.isManual && !p.systemId);
  const bom = cots.filter((p) => !(p.isManual && !p.systemId));
  const cleanup = cleanupRows as Record<
    string,
    { from?: string; name?: string; note?: string; condition?: string | null }
  >;
  let renamed = 0;
  let noted = 0;
  let conditioned = 0;
  await db.transaction(async (tx) => {
    if (cots.length) {
      const [old] = await tx
        .select({ payload: onshapeCache.payload })
        .from(onshapeCache)
        .where(eq(onshapeCache.key, BACKUP));
      const kept = ((old?.payload as { parts?: unknown[] })?.parts ??
        []) as unknown[];
      await tx
        .insert(onshapeCache)
        .values({ key: BACKUP, payload: { parts: [...kept, ...cots] } })
        .onConflictDoUpdate({
          target: onshapeCache.key,
          set: {
            payload: { parts: [...kept, ...cots] },
            fetchedAt: new Date(),
          },
        });
    }
    if (general.length)
      await tx.delete(parts).where(
        inArray(
          parts.id,
          general.map((p) => p.id),
        ),
      );
    if (bom.length)
      await tx
        .update(parts)
        .set({
          designState: COTS_DEFAULT_STATUS,
          cotsClearedAt: null,
          cotsInStockAt: null,
          cotsSentBack: null,
        })
        .where(
          inArray(
            parts.id,
            bom.map((p) => p.id),
          ),
        );

    const conditions = new Map(
      (await tx.select().from(inventoryConditions)).map((c) => [c.label, c.id]),
    );
    const seedByKey = new Map(SEED.map((s) => [s.key, s]));
    for (const [key, c] of Object.entries(cleanup)) {
      const id = state.items[key];
      if (!id || state.cleaned![key]) continue;
      const [item] = await tx
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.id, id));
      state.cleaned![key] = true;
      if (!item) continue;
      const seedCondition = seedByKey.get(key)?.condition;
      const values = {
        ...(c.name && item.name === c.from && { name: c.name }),
        ...(c.note && !item.note && { note: c.note }),
        ...(c.condition !== undefined &&
          item.conditionId ===
            (seedCondition
              ? (conditions.get(seedCondition) ?? null)
              : null) && {
            conditionId: c.condition
              ? (conditions.get(c.condition) ?? null)
              : null,
          }),
      };
      if (!Object.keys(values).length) continue;
      if (values.name) renamed++;
      if (values.note) noted++;
      if ("conditionId" in values) conditioned++;
      await tx
        .update(inventoryItems)
        .set(values)
        .where(eq(inventoryItems.id, id));
      await recordItemChanges(tx, id, item, values, ctx);
      if (values.name) await pushItemToCards(tx, id, { name: values.name });
    }
    await writeState(state, tx);
  });
  return {
    deletedGeneralCards: general.length,
    resetBomParts: bom.length,
    renamed,
    noted,
    conditioned,
  };
}

// Hebrew words in item names, in the English the stores use.
const HE_EN: [RegExp, string][] = [
  [/סושי/g, "Sushi Wheel"],
  [/קומפליינט/g, "Compliant Wheel"],
  [/קולסון/g, "Colson Wheel"],
  [/כוכב/g, "Star Wheel"],
  [/פלאיוויל|פלייוויל/g, "Flywheel"],
  [/מקאנום/g, "Mecanum Wheel"],
  [/אומני/g, "Omni Wheel"],
  [/גג"?ש|גלגל שיניים/g, "Gear"],
  [/פולי/g, "Pulley"],
  [/רצועה/g, "Timing Belt"],
  [/ספרוקט/g, "Sprocket"],
  [/מיסב/g, "Bearing"],
  [/קראקן/g, "Kraken"],
  [/פאלקון/g, "Falcon"],
  [/ליימלייט/g, "Limelight"],
  [/רובוריו/g, "roboRIO"],
  [/קניבור/g, "CANivore"],
  [/פיג'ין/g, "Pigeon 2.0"],
  [/קנדי/g, "CANdi"],
  [/קניפייר/g, "CANifier"],
  [/ברייקר/g, "120A Breaker"],
  [/פיוז/g, "Snap Action Breaker"],
  [/אנדרסון/g, "Anderson Powerpole"],
];

// A store query for an item: its name in English, without Hebrew asides or colors and sizes the
// stores don't put in titles.
export function storeQuery(name: string) {
  let q = name;
  for (const [he, en] of HE_EN) q = q.replace(he, ` ${en} `);
  return q
    .replace(/\([^)]*[\u0590-\u05ff][^)]*\)/g, " ")
    .replace(/[\u0590-\u05ff]+/g, " ")
    .replace(/[–—,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/(\d)\s*(″|”|"|inch\b|in\b)/g, "$1in")
    .replace(/(\d)\s*(tooth|teeth)\b/g, "$1t")
    .replace(/(\d)\s*(t|mm|dp|a|v)\b/g, "$1$2")
    .replace(/["'”″]/g, "")
    .split(/[\s,()|/\-–]+/)
    .filter((w) => w.length > 1 && !/^(with|for|and|the|of|x|×)$/.test(w));

// The offer whose title holds every number of the query (sizes, teeth, amps) and most of its
// words (three in four), best first.
export function bestOffer<O extends { title: string }>(
  query: string,
  offers: O[],
) {
  const want = [...new Set(tokens(query))];
  if (!want.length) return null;
  let best: { offer: O; score: number } | null = null;
  for (const o of offers) {
    const have = new Set(tokens(o.title));
    if (!want.filter((w) => /\d/.test(w)).every((w) => have.has(w))) continue;
    const score = want.filter((w) => have.has(w)).length / want.length;
    if (score >= 0.75 && (!best || score > best.score))
      best = { offer: o, score };
  }
  return best;
}

const RELINK_GROUPS = new Set(["cots", "electrical", "tools"]);

// What search would pick for a query: for tuning queries from production.
export async function searchPreview(q: string) {
  const { groups } = await searchProducts(q);
  const offers = groups.flatMap((g) =>
    g.offers.map((o) => ({ ...o, image: o.image ?? g.image })),
  );
  const best = bestOffer(storeQuery(q), offers);
  return {
    query: storeQuery(q),
    best: best && { ...best.offer, score: best.score },
    offers: offers
      .slice(0, 15)
      .map((o) => `${o.vendor} | ${o.title} | ${o.price}`),
  };
}

// Step 4: every COTS, electrical and tool item missing a link, price or photo gets them from its
// link, or from the store search for its English name. A member's own values are kept. With
// dry, it only says what it would pick; retry tries the not-found ones again. One item at a
// time, with a pause, because the stores stop answering a burst of searches.
export async function relinkInventory(
  deadline: number,
  dry = false,
  retry = false,
) {
  const state = await readState();
  if (retry)
    for (const [id, r] of Object.entries(state.relinked!))
      if (r !== "linked") delete state.relinked![id];
  const groups = new Map(
    (await listCategories()).map((c) => [c.id, c.group as string]),
  );
  const items = (await db.select().from(inventoryItems)).filter(
    (i) =>
      i.category &&
      RELINK_GROUPS.has(groups.get(i.category) ?? "") &&
      (!i.cotsLinks.length || !i.imagePath || i.price == null) &&
      (dry || !state.relinked![i.id]),
  );
  const seedQuery = new Map(
    SEED.filter((s) => s.search).map((s) => [state.items[s.key], s.search!.q]),
  );
  const picks: string[] = [];
  let done = 0;
  for (let i = 0; i < items.length && Date.now() < deadline - 12_000; i++) {
    if (i) await new Promise((r) => setTimeout(r, 700));
    await Promise.all(
      items.slice(i, i + 1).map(async (item) => {
        try {
          let found: Found | null = null;
          const link = item.cotsLinks[0];
          if (link) {
            try {
              const p = await readProduct(link.url);
              found = {
                link,
                price: toUsd(p.price, p.currency),
                image: p.image,
              };
            } catch {}
          }
          if (!found?.image || found.price == null)
            for (const q of [seedQuery.get(item.id), storeQuery(item.name)]) {
              if (!q || q.length < 3) continue;
              const { groups: g } = await searchProducts(q);
              const offers = g.flatMap((x) =>
                x.offers.map((o) => ({ ...o, image: o.image ?? x.image })),
              );
              const best = bestOffer(q, offers);
              if (!best) continue;
              found = {
                link: found?.link ?? {
                  url: best.offer.url,
                  site: best.offer.vendor,
                },
                price: found?.price ?? best.offer.price,
                image: found?.image ?? best.offer.image,
              };
              if (dry)
                picks.push(
                  `${item.name} ⇒ ${best.offer.vendor} | ${best.offer.title} | ${best.score.toFixed(2)}`,
                );
              break;
            }
          if (dry) {
            if (!found)
              picks.push(`${item.name} ⇒ none (${storeQuery(item.name)})`);
            return;
          }
          if (!found) {
            state.relinked![item.id] = "none";
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
                .where(eq(inventoryItems.id, item.id));
              await recordItemChanges(tx, item.id, item, values, ctx);
              await pushItemToCards(tx, item.id, values);
            });
          if (found.image && !item.imagePath) {
            const key = await saveProductPhoto(item.id, found.image);
            if (key)
              await db
                .update(inventoryItems)
                .set({ imagePath: key })
                .where(
                  and(
                    eq(inventoryItems.id, item.id),
                    isNull(inventoryItems.imagePath),
                  ),
                );
          }
          state.relinked![item.id] = "linked";
        } catch {
          if (!dry) state.relinked![item.id] = "error";
        } finally {
          done++;
        }
      }),
    );
    if (!dry) await writeState(state);
    if (dry && picks.length >= 40) break;
  }
  const results = Object.values(state.relinked!);
  return {
    triedNow: done,
    remaining: items.length - done,
    linked: results.filter((r) => r === "linked").length,
    notFound: results.filter((r) => r === "none").length,
    errors: results.filter((r) => r === "error").length,
    ...(dry && { picks }),
  };
}
