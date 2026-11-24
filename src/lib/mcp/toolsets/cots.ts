import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { partChangesCapability } from "@/components/shell/mode";
import { db, schema } from "@/db";
import { autoLink } from "@/lib/inventory/autolink";
import { listCategories } from "@/lib/data/categories";
import { cotsCategories } from "@/lib/data/parts";
import { groupSameCots } from "@/lib/cots";
import { planPartUpdate } from "@/lib/parts/changes";
import { applySuggestions } from "@/lib/review/review";
import { orderStatus } from "@/lib/status";
import { uuid, read, write, ToolError, nameOf, normaliseChanges, readable } from "../registry";
import { robotNotOld } from "@/lib/robotFolders";

const { parts, systems } = schema;

// COTS: official names, product links and prices.

const COTS_WORKFLOW =
  "Workflow for each part: find it on FRCDesign.org (FRCDesignLib, the Onshape library the team's COTS models come from), which names the product and its vendor; " +
  "search the web for the product page on the vendor's site and on every other store that sells the same product (WCP, REV, AndyMark, VEX, TTB, SDS, Swyft, goBILDA, McMaster-Carr, …); " +
  "then set_cots_info with the official product name, every product page link (the main vendor first) with its price, and the average price of one at the quantity needed (pack sizes and quantity breaks included). " +
  "Only use pages you actually opened; leave out what you couldn't find.";

read(
  "cots_parts_to_look_up",
  "member",
  `COTS parts to look up online. The same part in several systems of a robot comes back once, with every part_id and the total quantity. By default only parts missing links or a price. ${COTS_WORKFLOW}`,
  z.object({
    robot_id: uuid.optional(),
    include_done: z.boolean().optional().describe("Also return parts that already have links and a price."),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  async ({ robot_id, include_done, limit = 100 }) => {
    const where = [isNull(parts.removedFromCadAt), eq(parts.classification, "cots"), robotNotOld];
    if (robot_id) where.push(eq(systems.robotId, robot_id));
    const rows = (
      await db
        .select({ part: parts, systemName: systems.name, robotId: systems.robotId, robotName: schema.robots.name })
        .from(parts)
        .innerJoin(systems, eq(systems.id, parts.systemId))
        .innerJoin(schema.robots, eq(schema.robots.id, systems.robotId))
        .where(and(...where))
        .orderBy(asc(schema.robots.name), asc(systems.name), asc(parts.onshapeName))
    ).map((r) => ({ ...r.part, systemName: r.systemName, robotId: r.robotId, robotName: r.robotName }));
    const robotIds = [...new Set(rows.map((r) => r.robotId))];
    const groups = robotIds
      .flatMap((id) => groupSameCots(rows.filter((r) => r.robotId === id)))
      .filter((g) => include_done || g.some((p) => !p.cotsLinks.length || p.unitPrice == null));
    const { categories, of } = await cotsCategories(groups.slice(0, limit).map((g) => g[0]));
    return {
      total: groups.length,
      parts: groups.slice(0, limit).map((g) => ({
        part_ids: g.map((p) => p.id),
        name: nameOf(g[0]),
        onshape_name: g[0].onshapeName,
        robot: g[0].robotName,
        systems: [...new Set(g.map((p) => p.systemName))],
        quantity: g.reduce((n, p) => n + p.quantity, 0),
        status: orderStatus(g[0]),
        category: of.get(g[0].id),
        links: g[0].cotsLinks,
        unit_price_usd: g[0].unitPrice,
      })),
      truncated: groups.length > limit,
      categories: categories.map((c) => c.id),
    };
  },
);

const cotsInfoInput = z.object({
  part_ids: z.array(uuid).min(1).max(100).describe("Every part_id of the part, from cots_parts_to_look_up."),
  official_name: z.string().trim().min(1).max(200).optional().describe("The product's official name, as the vendor lists it."),
  links: z
    .array(
      z.object({
        url: z.url({ protocol: /^https?$/ }),
        site: z.string().trim().max(100).optional().describe("The store's name, e.g. 'WCP'."),
        price_usd: z.number().min(0).optional().describe("The price of one on this site, in US dollars."),
      }),
    )
    .max(20)
    .optional()
    .describe("Every product page found, the main vendor first. Replaces the part's links."),
  unit_price_usd: z.number().min(0).optional().describe("The average price of one at the quantity needed, in US dollars."),
  category: z.string().optional().describe("The COTS page filter box: an inventory category id from list_inventory_categories (a linked item's category wins)."),
});

// The COTS page's rule for the same fields: links, price and filter box are team work; a new
// name is a part field only an admin in Edit mode changes (partChangesCapability).
const cotsInfoCapability = (i: z.infer<typeof cotsInfoInput>) =>
  partChangesCapability({
    ...(i.official_name !== undefined ? { displayName: true } : {}),
    ...(i.links !== undefined ? { cotsLinks: true } : {}),
    ...(i.unit_price_usd !== undefined ? { unitPrice: true } : {}),
    ...(i.category !== undefined ? { cotsCategory: true } : {}),
  });

write(
  "set_cots_info",
  { cap: ({ items }) => items.map(cotsInfoCapability), destructive: true },
  `Set COTS parts' official name, product links, average price and filter box, found online. The parts change at once (undo_batch reverts it). A new official name needs an admin in Edit mode, as renaming a part does in the app; links, prices and the filter box need a team. ${COTS_WORKFLOW}`,
  z.object({ items: z.array(cotsInfoInput).min(1).max(200) }),
  async ({ items }, { member, aiName }) => {
    const edits = items.flatMap((item) => {
      const changes = normaliseChanges({
        ...(item.official_name !== undefined ? { displayName: item.official_name } : {}),
        ...(item.links !== undefined ? { cotsLinks: item.links.map((l) => ({ url: l.url, ...(l.site ? { site: l.site } : {}), ...(l.price_usd !== undefined ? { priceUsd: l.price_usd } : {}) })) } : {}),
        ...(item.unit_price_usd !== undefined ? { unitPrice: item.unit_price_usd } : {}),
        ...(item.category !== undefined ? { cotsCategory: item.category } : {}),
      });
      return item.part_ids.map((id) => ({ id, changes, reason: null }));
    });
    const ids = edits.map((e) => e.id);
    if (new Set(ids).size !== ids.length) throw new ToolError("Each part may appear once.");
    const catIds = (await listCategories()).map((c) => c.id);
    const badCat = items.find((i) => i.category !== undefined && !catIds.includes(i.category));
    if (badCat) throw new ToolError(`Unknown category "${badCat.category}". See list_inventory_categories.`);
    const rows = await db.select().from(parts).where(inArray(parts.id, ids));
    if (rows.length !== ids.length) throw new ToolError("Some part ids don't exist.");
    const notCots = rows.filter((p) => p.classification !== "cots");
    if (notCots.length) throw new ToolError(`Not COTS parts: ${notCots.map(nameOf).join(", ")}.`);
    const byId = new Map(edits.map((e) => [e.id, e.changes]));
    const diffs = rows
      .map((p) => ({ id: p.id, part: nameOf(p), changes: planPartUpdate(p, byId.get(p.id)!, "mcp").history }))
      .filter((d) => d.changes.length);
    return {
      count: diffs.length,
      summary: `Looked up ${diffs.length} COTS ${diffs.length === 1 ? "part" : "parts"}: ${[...new Set(items.map((i) => i.official_name).filter(Boolean))].slice(0, 3).join(", ")}`,
      preview: diffs.map((d) => ({ id: d.id, part: d.part, changes: d.changes.map(readable) })),
      apply: async () => {
        const { batchId, changed } = await applySuggestions(edits, { memberId: member.id, source: "ai", via: "mcp", aiName });
        // A product link an inventory item already has links the part to it (into To Review).
        const auto_linked = await autoLink({ partIds: edits.map((e) => e.id) }, { memberId: member.id, via: "mcp" });
        return { changed, batch_id: batchId, auto_linked, undo: `undo_batch with batch_id ${batchId}`, next: "The parts also wait in To Review for their designer." };
      },
    };
  },
);
