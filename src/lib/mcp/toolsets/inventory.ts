import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { effectiveMode } from "@/components/shell/mode";
import { db, schema } from "@/db";
import { vendorOfUrl } from "@/config/vendors";
import { listInventory } from "@/lib/data/inventory";
import { autoLink, fastenerLinkProblems, findLinks, writePendingLinks } from "@/lib/inventory/autolink";
import { checkSpecs, fieldChoices, getCategory, sizeOrderProblem, slugify, type InvCategory } from "@/lib/inventory/categories";
import { recordItemChanges } from "@/lib/inventory/history";
import { pushItemToCards } from "@/lib/inventory/cotsSync";
import { readProduct, saveProductPhoto } from "@/lib/inventory/product";
import { CATEGORY_GROUPS, isCategoryGroup } from "@/config/inventory";
import { addCategoryForReview, applyItemEdits } from "@/lib/review/inventory";
import { createItem } from "@/lib/inventory/create";
import { listCategories } from "@/lib/data/categories";
import { moveStock } from "@/lib/inventory/moves";
import { statusChangeDeniedFor } from "@/lib/mode";
import { applyEachPartChanges } from "@/lib/parts/apply";
import { uuid, read, write, ToolError, nameOf } from "../registry";
import { robotNotOld } from "@/lib/robotFolders";

const { parts, systems, robots, inventoryItems, inventoryLocations } = schema;

// The shared inventory: stock, items, links to BOM parts, specs, products and categories.

write(
  "adjust_stock",
  { cap: "work", destructive: true },
  "Add to or take from an inventory item's stock (delta can be negative; sheet items take pieces such as 0.25, 1/3 = 0.3333). Say why: received (an order came), used, broke, counted (a recount), returned.",
  z.object({ item_id: uuid, delta: z.number(), reason: z.enum(["received", "used", "broke", "counted", "returned"]).optional() }),
  async ({ item_id, delta, reason }, { member, aiName }) => {
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, item_id));
    if (!item) throw new ToolError("No such inventory item.");
    const to = Math.max(0, item.inStock + delta);
    return {
      count: to === item.inStock ? 0 : 1,
      preview: { item: item.name, in_stock: { from: item.inStock, to } },
      apply: async () => {
        const batchId = randomUUID();
        const moved = await db.transaction((tx) =>
          moveStock(tx, { itemId: item_id, delta, reason: reason ?? (delta > 0 ? "received" : "used") }, { memberId: member.id, via: "mcp", aiName, batchId }),
        );
        return { item: item.name, in_stock: moved?.to, batch_id: batchId };
      },
    };
  },
);

write(
  "add_inventory_item",
  { cap: "work", destructive: false },
  "Add an item to the team inventory.",
  z.object({
    name: z.string().min(1),
    in_stock: z.number().int().min(0).default(0),
    product_url: z.url().optional(),
  }),
  async (a, { member, aiName }) => ({
    count: 1,
    summary: `Added ${a.name}`,
    preview: a,
    apply: async () => {
      const batchId = randomUUID();
      const id = await db.transaction(async (tx) => {
        const ctx = { memberId: member.id, via: "mcp" as const, aiName, batchId };
        return createItem(tx, { name: a.name, cotsLinks: a.product_url ? [{ url: a.product_url, site: vendorOfUrl(a.product_url) }] : [] }, a.in_stock, ctx);
      });
      const auto_linked = await autoLink({ itemIds: [id] }, { memberId: member.id, via: "mcp" });
      return { item_id: id, batch_id: batchId, auto_linked };
    },
  }),
);

read(
  "list_inventory_categories",
  "member",
  "The inventory's categories and each one's fields (number, text, options, or a base material from the Settings list), with the allowed choices. Use the ids with add_inventory_items and set_inventory_info. Sheet categories count sheets and pieces of a sheet. The team edits these on the Settings page.",
  z.object({}),
  async () => ({
    categories: (await listCategories()).map((c) => ({
      id: c.id,
      label: c.label,
      group: c.group,
      sheet: c.sheet,
      fields: c.fields.filter((f) => !f.hidden).map((f) => ({ id: f.id, label: f.label, kind: f.kind, onlyForType: f.when, choices: fieldChoices(f).length ? fieldChoices(f) : undefined })),
    })),
  }),
);

read(
  "inventory_to_link",
  "member",
  "COTS parts on active robots that aren't linked to an inventory item yet, with the item the site's auto-link thinks each one is (score 0-100 and why: same Onshape part or product link, sizes and words in the name, same picture as a linked part) and a compact list of every item, so you can match the rest. Suggest links with link_inventory; they wait in To Review.",
  z.object({ robot_id: uuid.optional(), limit: z.number().int().min(1).max(500).optional() }),
  async ({ robot_id, limit = 200 }) => {
    const [rows, items] = await Promise.all([
      db
        .select({ part: parts, systemName: systems.name, robotId: robots.id, robotName: robots.name })
        .from(parts)
        .innerJoin(systems, eq(systems.id, parts.systemId))
        .innerJoin(robots, eq(robots.id, systems.robotId))
        .where(and(isNull(parts.inventoryItemId), isNull(parts.removedFromCadAt), eq(parts.classification, "cots"), robotNotOld, robot_id ? eq(robots.id, robot_id) : undefined)),
      listInventory().then((r) => r.items),
    ]);
    const { found } = await findLinks({ partIds: rows.slice(0, limit).map((r) => r.part.id) });
    const guess = new Map(found.map((f) => [f.partId, f]));
    return {
      total: rows.length,
      parts: rows.slice(0, limit).map((r) => {
        const hit = guess.get(r.part.id);
        return {
          part_id: r.part.id,
          name: nameOf(r.part),
          robot: r.robotName,
          system: r.systemName,
          quantity: r.part.quantity,
          product_link: r.part.cotsLinks[0]?.url ?? null,
          suggestion: hit ? { item_id: hit.itemId, item: items.find((i) => i.id === hit.itemId)?.name, score: hit.score, why: hit.why } : null,
        };
      }),
      items: items.map((i) => ({ id: i.id, name: i.name, category: i.category, specs: i.specs, in_stock: i.inStock })),
      truncated: rows.length > limit,
    };
  },
);

write(
  "link_inventory",
  { cap: "work", destructive: true },
  "Suggest links from BOM parts to inventory items (item_id null unlinks at once). A link waits in To Review with your name until the part's designer approves it; then the part draws on the item's stock, shared by every active robot. Rejected links are remembered.",
  z.object({ links: z.array(z.object({ part_id: uuid, item_id: uuid.nullable(), reason: z.string().max(300).optional() })).min(1).max(1000) }),
  async ({ links }, { member, aiName }) => {
    const [rows, items] = await Promise.all([
      db.select().from(parts).where(inArray(parts.id, links.map((l) => l.part_id))),
      db.select({ id: inventoryItems.id, name: inventoryItems.name }).from(inventoryItems),
    ]);
    const changes = links.flatMap((l) => {
      const part = rows.find((p) => p.id === l.part_id);
      return part && part.inventoryItemId !== l.item_id ? [{ part, itemId: l.item_id }] : [];
    });
    const bad = links.find((l) => l.item_id && !items.some((i) => i.id === l.item_id));
    if (bad) throw new ToolError(`No inventory item ${bad.item_id}.`);
    const unlinking = changes.filter((c) => !c.itemId).map((c) => c.part.id);
    const denied = unlinking.length ? await statusChangeDeniedFor(effectiveMode(member), unlinking, { inventoryItemId: null }) : null;
    if (denied) throw new ToolError(denied);
    const wrong = await fastenerLinkProblems(changes.flatMap((c) => (c.itemId ? [{ partId: c.part.id, itemId: c.itemId }] : [])));
    if (wrong.length) throw new ToolError(`Fasteners link only to the same thread, length and head: ${wrong.slice(0, 20).join("; ")}`);
    return {
      count: changes.length,
      summary: `${changes.length} inventory ${changes.length === 1 ? "link" : "links"}: unlinks at once, links wait in To Review`,
      preview: changes.map((c) => ({ part_id: c.part.id, part: nameOf(c.part), item: c.itemId ? items.find((i) => i.id === c.itemId)?.name : null })),
      apply: async () => {
        const reasons = new Map(links.map((l) => [l.part_id, l.reason ?? null]));
        const unlink = changes.filter((c) => !c.itemId);
        const { batchId, changed } = await applyEachPartChanges(
          unlink.map((c) => ({ id: c.part.id, changes: { inventoryItemId: null } })),
          { memberId: member.id, via: "mcp" },
        );
        const waiting = await writePendingLinks(
          changes.filter((c) => c.itemId).map((c) => ({ partId: c.part.id, itemId: c.itemId!, reason: reasons.get(c.part.id) ?? null })),
          { memberId: member.id, source: "ai", via: "mcp", aiName },
        );
        return { unlinked: changed, waiting_in_to_review: waiting, batch_id: batchId };
      },
    };
  },
);

read(
  "inventory_shortages",
  "member",
  "Items the active robots need more of than the shelf has (all robots share one shelf), with the parts the stock doesn't cover and how many each is missing.",
  z.object({ robot_id: uuid.optional() }),
  async ({ robot_id }) => {
    const { items } = await listInventory();
    return items
      .filter((i) => (i.usage?.short ?? 0) > 0)
      .map((i) => {
        const u = i.usage!;
        return {
          item_id: i.id,
          item: i.name,
          in_stock: i.inStock,
          need: u.need,
          short: u.short,
          parts: u.parts
            .filter((p) => !robot_id || p.robotId === robot_id)
            .map((p) => ({ part_id: p.partId, name: p.partName, robot: p.robotName, system: p.systemName, status: p.status, missing: p.quantity - (u.coveredOf.get(p.partId) ?? 0) }))
            .filter((p) => p.missing > 0),
        };
      })
      .filter((i) => i.parts.length);
  },
);

const itemInfo = z.object({
  category: z.string().optional().describe("A category id from list_inventory_categories."),
  specs: z.record(z.string(), z.string()).optional().describe("The category's fields by id, e.g. { teeth: '24', bore: '1/2\" Hex' }."),
  product_url: z.url().optional().describe("The product's page."),
  price: z.number().min(0).optional().describe("US dollars for one."),
  season_need: z.number().min(0).optional().describe("How many the team wants on the shelf for the season, whatever the robots use; 0 clears it."),
});

// Category and specs checked against the team's categories.
function checkItemInfo(info: z.infer<typeof itemInfo>, current: { category: string | null; cotsLinks: { url: string }[] } | null, cats: InvCategory[]) {
  if (info.category && !getCategory(cats, info.category)) throw new ToolError(`Unknown category "${info.category}". See list_inventory_categories.`);
  const cat = getCategory(cats, info.category ?? current?.category);
  let specs: Record<string, string> | undefined;
  if (info.specs) {
    if (!cat) throw new ToolError("Specs need a category.");
    const checked = checkSpecs(cat, info.specs);
    if ("error" in checked) throw new ToolError(checked.error);
    const sizeProblem = sizeOrderProblem(cat, checked.values);
    if (sizeProblem) throw new ToolError(sizeProblem);
    specs = checked.values;
  }
  const links = current?.cotsLinks ?? [];
  return {
    ...(info.category ? { category: info.category } : {}),
    ...(specs ? { specs } : {}),
    ...(info.product_url && !links.some((l) => l.url === info.product_url) ? { cotsLinks: [{ url: info.product_url, site: vendorOfUrl(info.product_url) }, ...links] } : {}),
    ...(info.price != null ? { price: info.price } : {}),
    ...(info.season_need != null ? { seasonNeed: info.season_need > 0 ? info.season_need : null } : {}),
  };
}

write(
  "add_inventory_items",
  { cap: "work", destructive: false },
  "Add several items to the team inventory at once, e.g. from a spreadsheet, an order email or a photo of a shelf the member shares with you. New items are added at once (not to To Review) and show in AI logs, where they can be reverted. in_stock for sheet categories can have pieces (2.75 = 2 ¾ sheets). location is a shop map zone or drawer name (as items show it; Settings → Map); an unknown name creates a zone that an admin still has to draw on the map. BOM parts with the same product link or Onshape part are linked to the new items and wait in To Review.",
  z.object({ items: z.array(itemInfo.extend({ name: z.string().trim().min(1).max(200), in_stock: z.number().min(0).default(0), location: z.string().trim().max(100).optional() })).min(1).max(500) }),
  async ({ items }, { member, aiName }) => {
    const cats = await listCategories();
    const planned = items.map((i) => ({ input: i, values: checkItemInfo(i, null, cats) }));
    return {
      count: planned.length,
      summary: `Added ${planned.length} inventory ${planned.length === 1 ? "item" : "items"}`,
      preview: planned.map((p) => ({ name: p.input.name, in_stock: p.input.in_stock, location: p.input.location, ...p.values })),
      apply: async () => {
        const batchId = randomUUID();
        const ids = await db.transaction(async (tx) => {
          const locations = new Map((await tx.select().from(inventoryLocations)).map((l) => [l.name.toLowerCase(), l.id]));
          const out: string[] = [];
          for (const p of planned) {
            let locationId: string | null = null;
            if (p.input.location) {
              locationId = locations.get(p.input.location.toLowerCase()) ?? null;
              if (!locationId) {
                [{ id: locationId }] = await tx.insert(inventoryLocations).values({ name: p.input.location }).returning({ id: inventoryLocations.id });
                locations.set(p.input.location.toLowerCase(), locationId);
              }
            }
            const ctx = { memberId: member.id, via: "mcp" as const, aiName, batchId };
            out.push(await createItem(tx, { name: p.input.name, locationId, ...p.values }, p.input.in_stock, ctx));
          }
          return out;
        });
        const auto_linked = await autoLink({ itemIds: ids }, { memberId: member.id, via: "mcp" });
        return { item_ids: ids, batch_id: batchId, auto_linked };
      },
    };
  },
);

read(
  "inventory_to_look_up",
  "member",
  "Inventory items missing a category, specs, product link or price. Look them up (FRCDesign.org, the vendors' sites) and fill them in with set_inventory_info.",
  z.object({ limit: z.number().int().min(1).max(500).optional() }),
  async ({ limit = 200 }) => {
    const { items, categories } = await listInventory();
    const missing = items
      .map((i) => {
        const fields = getCategory(categories, i.category)?.fields.filter((f) => !f.hidden) ?? [];
        const gaps = [
          !i.categorySet && "category",
          fields.some((f) => !i.specs[f.id]) && "specs",
          !i.cotsLinks.length && "product_url",
          i.price == null && "price",
        ].filter(Boolean);
        return { item_id: i.id, name: i.name, guessed_category: i.category, specs: i.specs, product_url: i.cotsLinks[0]?.url ?? null, missing: gaps };
      })
      .filter((i) => i.missing.length);
    return { total: missing.length, items: missing.slice(0, limit), truncated: missing.length > limit };
  },
);

// The item's picture, copied to R2 like a link pasted in the item window: the exact image_url
// given, or the product page's picture (the variant's own, for a ?variant= link or an item whose
// name and specs name a color, durometer, teeth or bore). On a Shopify family page the item's link
// also becomes that variant's ?variant= link. Applied at once (not To Review); the old picture
// stays in R2, so reverting the batch can still show it. Returns how many pictures changed.
type PhotoJob = { id: string; imageUrl?: string; pageUrl?: string; want: string };
async function savePhotos(jobs: PhotoJob[], ctx: { memberId: string; aiName: string | null; batchId: string }) {
  let saved = 0;
  for (let i = 0; i < jobs.length; i += 8)
    await Promise.all(
      jobs.slice(i, i + 8).map(async (job) => {
        const page = !job.imageUrl && job.pageUrl ? await readProduct(job.pageUrl, 8000, job.want).catch(() => null) : null;
        const image = job.imageUrl ?? page?.image;
        const key = image ? await saveProductPhoto(job.id, image) : null;
        await db.transaction(async (tx) => {
          const [before] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, job.id)).for("update");
          if (!before) return;
          const values: { imagePath?: string; cotsLinks?: typeof before.cotsLinks } = {};
          if (key && key !== before.imagePath) values.imagePath = key;
          const old = before.cotsLinks.find((l) => l.url === job.pageUrl);
          if (page && old && page.url !== old.url && vendorOfUrl(page.url) === vendorOfUrl(old.url))
            values.cotsLinks = before.cotsLinks.map((l) => (l === old ? { ...l, url: page.url } : l));
          if (!Object.keys(values).length) return;
          await tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, job.id));
          await recordItemChanges(tx, job.id, before, values, { memberId: ctx.memberId, via: "mcp", aiName: ctx.aiName, batchId: ctx.batchId });
          if (values.cotsLinks) await pushItemToCards(tx, job.id, { cotsLinks: values.cotsLinks });
          if (values.imagePath) saved++;
        });
      }),
    );
  return saved;
}

write(
  "set_inventory_info",
  { cap: "work", destructive: true },
  "Edit existing inventory items (each item can differ): rename them (name), move them to another category or location, and fill in specs, product link, price, picture and season need. Name, category, specs, location and season need apply at once and wait in To Review's Inventory section with your name until a member approves (Reject puts the old values back). Product link, price and picture apply at once without To Review, and linked COTS cards follow. A new product_url replaces the item's link from the same store. Any product_url, even one the item already has, re-reads the page for its picture: for a Shopify family page (AndyMark, WCP, ThriftyBot) the variant is picked from ?variant= or the item's name and specs (color, durometer, teeth, bore, size), and the link becomes that variant's. image_url saves that exact picture instead; refresh_photo: true re-reads the item's current link without giving one, false skips the picture. REV and Redux pages can't be read per variant: pass image_url for them. Specs must use the category's fields and choices from list_inventory_categories. BOM parts with the same product link are then linked to the item and wait in To Review.",
  z.object({
    items: z
      .array(
        itemInfo.extend({
          item_id: uuid,
          name: z.string().trim().min(1).max(200).optional().describe("A new name for the item."),
          location: z.string().trim().min(1).max(100).optional().describe("The shop map zone or drawer it moves to, by name; a new name creates a zone still to be drawn."),
          image_url: z.url().optional().describe("The exact picture to save as the item's thumbnail."),
          refresh_photo: z.boolean().optional().describe("true: re-read the item's product page for its picture. false: leave the picture alone. Default: re-read when product_url is given."),
          reason: z.string().max(300).optional().describe("Why, shown on To Review."),
        }),
      )
      .min(1)
      .max(500),
  }),
  async ({ items }, { member, aiName }) => {
    const [rows, cats, locs] = await Promise.all([
      db.select().from(inventoryItems).where(inArray(inventoryItems.id, items.map((i) => i.item_id))),
      listCategories(),
      db.select().from(inventoryLocations),
    ]);
    const locationId = new Map(locs.map((l) => [l.name.toLowerCase(), l.id]));
    const locationName = new Map(locs.map((l) => [l.id, l.name]));
    const planned = items.map((i) => {
      const row = rows.find((r) => r.id === i.item_id);
      if (!row) throw new ToolError(`No inventory item ${i.item_id}.`);
      const values: Record<string, unknown> = { ...checkItemInfo(i, row, cats) };
      // The three PC stations keep their names and category (config/stations.ts).
      if (row.station && ((values.name !== undefined && values.name !== row.name) || (values.category !== undefined && values.category !== row.category))) throw new ToolError(`${row.name} is a PC station: it can't be renamed or moved to another category.`);
      // A new product link replaces the old one from the same store (a family page swapped for the
      // exact variant), so the card doesn't keep the wrong page as a second link.
      if (values.cotsLinks) {
        const [link, ...rest] = values.cotsLinks as typeof row.cotsLinks;
        values.cotsLinks = [link, ...rest.filter((l) => vendorOfUrl(l.url) !== vendorOfUrl(link.url))];
      }
      // Specs are merged, so filling bore and durometer keeps the color and width already there.
      if (values.specs) values.specs = { ...row.specs, ...(values.specs as Record<string, string>) };
      if (i.name && i.name !== row.name) values.name = i.name;
      const loc = i.location ? (locationId.get(i.location.toLowerCase()) ?? null) : undefined;
      const newLocation = i.location && loc === null ? i.location : null;
      if (loc && loc !== row.locationId) values.locationId = loc;
      // Product link and price skip To Review; the rest waits there.
      const { cotsLinks, price, ...review } = values;
      const product = { ...(cotsLinks !== undefined && { cotsLinks: cotsLinks as typeof row.cotsLinks }), ...(price !== undefined && { price: price as number }) };
      const pageUrl = i.product_url ?? (i.refresh_photo ? row.cotsLinks[0]?.url : undefined);
      const want = [i.name ?? row.name, ...Object.values((values.specs ?? row.specs) as Record<string, string>)].join(" ");
      const photo: PhotoJob | null =
        i.refresh_photo === false ? null : i.image_url ? { id: row.id, imageUrl: i.image_url, want } : pageUrl ? { id: row.id, pageUrl, want } : null;
      return { row, review, product, photo, newLocation, reason: i.reason ?? null };
    });
    const changed = planned.filter((p) => Object.keys(p.review).length || Object.keys(p.product).length || p.photo || p.newLocation);
    const reviewed = changed.filter((p) => Object.keys(p.review).length || p.newLocation);
    return {
      count: changed.length,
      summary: `Edited ${changed.length} inventory ${changed.length === 1 ? "item" : "items"}${reviewed.length ? `, ${reviewed.length} waiting in To Review` : ""}`,
      preview: changed.map((p) => ({
        item_id: p.row.id,
        item: p.row.name,
        set: { ...p.review, ...p.product, ...("locationId" in p.review ? { locationId: undefined, location: locationName.get(p.review.locationId as string) } : {}) },
        ...(p.newLocation ? { new_location: p.newLocation } : {}),
        ...(p.photo ? { picture: p.photo.imageUrl ?? `read from ${p.photo.pageUrl}` } : {}),
      })),
      apply: async () => {
        // New shelves first, so the items can move onto them.
        for (const p of changed) {
          if (!p.newLocation) continue;
          let id = locationId.get(p.newLocation.toLowerCase());
          if (!id) {
            [{ id }] = await db.insert(inventoryLocations).values({ name: p.newLocation }).returning({ id: inventoryLocations.id });
            locationId.set(p.newLocation.toLowerCase(), id);
          }
          if (id !== p.row.locationId) p.review.locationId = id;
        }
        const batchId = randomUUID();
        const ctx = { memberId: member.id, aiName: aiName ?? null, batchId };
        const n = await applyItemEdits(
          changed.filter((p) => Object.keys(p.review).length).map((p) => ({ itemId: p.row.id, values: p.review, reason: p.reason })),
          ctx,
        );
        const linked = changed.filter((p) => Object.keys(p.product).length);
        await db.transaction(async (tx) => {
          for (const p of linked) {
            const [before] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, p.row.id)).for("update");
            if (!before) continue;
            await tx.update(inventoryItems).set(p.product).where(eq(inventoryItems.id, p.row.id));
            await recordItemChanges(tx, p.row.id, before, p.product, { ...ctx, via: "mcp" });
            await pushItemToCards(tx, p.row.id, p.product);
          }
        });
        const photos = await savePhotos(changed.flatMap((p) => (p.photo ? [p.photo] : [])), ctx);
        const auto_linked = await autoLink({ itemIds: linked.filter((p) => p.product.cotsLinks).map((p) => p.row.id) }, { memberId: member.id, via: "mcp" });
        return { changed: changed.length, waiting_in_to_review: n, products_updated: linked.length, batch_id: batchId, photos_updated: photos, auto_linked };
      },
    };
  },
);

write(
  "link_inventory_products",
  { cap: "work", destructive: true },
  "Link inventory items to their exact product page (one batch of up to 40). Applies at once, not through To Review, and shows in AI logs where it can be reverted. The link becomes the item's first product link (replacing the old link from the same store); image_url and price are read from the page when not given (a Shopify ?variant= link gives that variant's own picture and price). The picture is copied into the app as the item's thumbnail, official_name renames the item, and COTS cards linked to the item get the new link and price. Find items without pictures with search_inventory (has_image) and products with search_online_products. The preview shows the given values; what is read from the pages shows in the result.",
  z.object({
    items: z
      .array(
        z.object({
          item_id: uuid,
          product_url: z.url().describe("The exact product (or variant) page."),
          image_url: z.url().optional().describe("The product's picture; read from the page when left out."),
          price: z.number().min(0).optional().describe("US dollars for one; read from the page when left out."),
          site: z.string().trim().min(1).max(60).optional().describe("The store's name; worked out from the link when left out."),
          official_name: z.string().trim().min(1).max(200).optional().describe("The product's official name, to rename the item."),
        }),
      )
      .min(1)
      .max(40),
  }),
  async ({ items }, { member, aiName }) => {
    const rows = await db.select().from(inventoryItems).where(inArray(inventoryItems.id, items.map((i) => i.item_id)));
    const planned = items.map((i) => {
      const row = rows.find((r) => r.id === i.item_id);
      if (!row) throw new ToolError(`No inventory item ${i.item_id}.`);
      return { input: i, row };
    });
    return {
      count: planned.length,
      summary: `Linked ${planned.length} inventory ${planned.length === 1 ? "item" : "items"} to their products`,
      preview: planned.map(({ input: i, row }) => ({
        item_id: row.id,
        item: row.name,
        product_url: i.product_url,
        image: i.image_url ?? "read from the page",
        price: i.price ?? (i.image_url ? row.price : "read from the page"),
        ...(i.official_name && i.official_name !== row.name ? { rename_to: i.official_name } : {}),
      })),
      apply: async () => {
        const batchId = randomUUID();
        const ctx = { memberId: member.id, via: "mcp" as const, aiName: aiName ?? null, batchId };
        const results: unknown[] = [];
        // A few at a time, so 40 store pages and pictures fit in one call.
        for (let n = 0; n < planned.length; n += 8)
          await Promise.all(
            planned.slice(n, n + 8).map(async ({ input: i, row }) => {
              const want = [i.official_name ?? row.name, ...Object.values(row.specs ?? {})].join(" ");
              const page = i.image_url && i.price != null ? null : await readProduct(i.product_url, 8000, want).catch(() => null);
              // A Shopify family page comes back as the variant's own link.
              const url = page?.url ?? i.product_url;
              const imageUrl = i.image_url ?? page?.image ?? null;
              const price = i.price ?? page?.price ?? undefined;
              const key = imageUrl ? await saveProductPhoto(row.id, imageUrl) : null;
              const link = { url, site: i.site ?? vendorOfUrl(url) };
              const values = {
                cotsLinks: [link, ...row.cotsLinks.filter((l) => l.url !== url && vendorOfUrl(l.url) !== vendorOfUrl(url))],
                ...(price != null ? { price } : {}),
                ...(key ? { imagePath: key } : {}),
                ...(i.official_name && i.official_name !== row.name ? { name: i.official_name } : {}),
              };
              await db.transaction(async (tx) => {
                await tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, row.id));
                await recordItemChanges(tx, row.id, row, values, ctx);
                await pushItemToCards(tx, row.id, { cotsLinks: values.cotsLinks, ...(price != null && { price }), ...(values.name && { name: values.name }) });
              });
              results.push({
                item_id: row.id,
                product_url: url,
                price: price ?? row.price,
                image_saved: Boolean(key),
                ...(!key ? { image_problem: imageUrl ? "The picture couldn't be downloaded." : "No picture found on the page; pass image_url." } : {}),
                ...(i.price == null && price == null ? { price_problem: "No price found on the page; pass price." } : {}),
              });
            }),
          );
        const auto_linked = await autoLink({ itemIds: planned.map((p) => p.row.id) }, { memberId: member.id, via: "mcp" });
        return { batch_id: batchId, linked: results.length, images_saved: results.filter((r) => (r as { image_saved: boolean }).image_saved).length, items: results, auto_linked };
      },
    };
  },
);

write(
  "add_inventory_category",
  { cap: "manage", destructive: false },
  `Add a new inventory category with its fields, when items don't fit any category in list_inventory_categories (check it first so you don't make a duplicate). It is created at once, so you can put items in it with set_inventory_info or add_inventory_items, and waits in To Review's Inventory section with your name; Reject removes it again and its items lose the category. group is one of: ${CATEGORY_GROUPS.map((g) => `${g.id} (${g.text})`).join(", ")}.`,
  z.object({
    label: z.string().trim().min(1).max(60).describe("Plural name, e.g. 'Pulleys'."),
    noun: z.string().trim().max(40).optional().describe("Ends an item's built name, e.g. 'Pulley' in '36T HTD 5mm Pulley'. Defaults to the label without a final s."),
    group: z.string().refine(isCategoryGroup, "Unknown group.").describe("The Inventory home group."),
    sheet: z.boolean().optional().describe("Counted in whole sheets and pieces of one (plates, sheet stock)."),
    fields: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(60).describe("e.g. 'Teeth'."),
          kind: z.enum(["number", "text", "options"]),
          options: z.array(z.string().trim().min(1).max(60)).max(100).optional().describe("The choices, for kind options."),
          name: z.string().max(40).optional().describe("How the value goes into the item's built name, '{}' standing for it (' {}T' gives '36T'). Spacing is kept as written: start with a space to separate it from the value before ('x{}' sticks to it). Empty leaves the value out; left out, it is ' {}'."),
        }),
      )
      .max(20)
      .default([]),
    reason: z.string().max(300).optional().describe("Why, shown on To Review."),
  }),
  async (a, { member, aiName }) => {
    const cats = await listCategories();
    const dup = cats.find((c) => c.label.toLowerCase() === a.label.toLowerCase());
    if (dup) throw new ToolError(`There is already a category "${dup.label}" (id ${dup.id}).`);
    let id = slugify(a.label);
    for (let n = 2; cats.some((c) => c.id === id); n++) id = `${slugify(a.label)}-${n}`;
    const fields = a.fields.map((f) => ({
      id: slugify(f.label),
      label: f.label,
      kind: f.kind,
      ...(f.kind === "options" && f.options?.length ? { options: f.options } : {}),
      ...(f.name != null ? { name: f.name } : {}),
    }));
    if (new Set(fields.map((f) => f.id)).size !== fields.length) throw new ToolError("Two fields have the same name.");
    if (fields.some((f) => f.kind === "options" && !f.options)) throw new ToolError("A field of kind options needs its options.");
    const cat = { id, label: a.label, noun: a.noun ?? a.label.replace(/s$/i, ""), group: a.group, sheet: !!a.sheet, fields };
    return {
      count: 1,
      summary: `Added the inventory category ${a.label}, waiting in To Review`,
      preview: cat,
      apply: async () => {
        const batchId = randomUUID();
        await addCategoryForReview(cat, { memberId: member.id, aiName: aiName ?? null, batchId, reason: a.reason ?? null });
        return { category_id: id, batch_id: batchId, waiting_in_to_review: true };
      },
    };
  },
);
