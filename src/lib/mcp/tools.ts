import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { findMachineByName, getMachine, MACHINES } from "@/config/machines";
import { COTS_STATUSES } from "@/config/cots";
import { STATUSES } from "@/config/statuses";
import { PRIORITIES } from "@/config/priorities";
import { db, schema } from "@/db";
import type { Member } from "@/lib/auth";
import { vendorOfUrl } from "@/config/vendors";
import { listInventory } from "@/lib/data/inventory";
import { autoLink, findLinks, writePendingLinks } from "@/lib/inventory/autolink";
import { checkSpecs, fieldChoices, getCategory, slugify, type InvCategory } from "@/lib/inventory/categories";
import { recordItemChanges } from "@/lib/inventory/history";
import { pushItemToCards } from "@/lib/inventory/cotsSync";
import { readProduct, saveProductPhoto } from "@/lib/inventory/product";
import { searchProducts } from "@/lib/inventory/search";
import { CATEGORY_GROUPS, isCategoryGroup } from "@/config/inventory";
import { addCategoryForReview, applyItemEdits } from "@/lib/review/inventory";
import { listCategories } from "@/lib/data/categories";
import { listMaterialGroups, listRawStock } from "@/lib/data/materials";
import { cotsCategories } from "@/lib/data/parts";
import { moveStock } from "@/lib/inventory/moves";
import { hasSeasonNeed, missing } from "@/lib/inventory/season";
import { formatStock } from "@/lib/inventory/stock";
import { listRobots } from "@/lib/data/robots";
import { OnshapeError } from "@/lib/onshape/client";
import { refreshThumbnails } from "@/lib/onshape/thumbnails";
import { applyEachPartChanges, applyPartChanges } from "@/lib/parts/apply";
import { groupSameCots } from "@/lib/cots";
import { partChangesSchema, planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { planUndo } from "@/lib/parts/undo";
import { applySuggestions, logAiAction, partsToSetUp, revertAiBatch } from "@/lib/review/review";
import { computeStatus } from "@/lib/status";
import { statusBreakdown } from "@/lib/stats";
import { updateBomFromOnshape } from "@/lib/sync/updateBom";
import { checkConfirmToken, confirmToken } from "./confirm";
import type { DrawingEdits } from "@/db/schema";
import { loadDrawing, makeDrawings } from "@/lib/drawing/make";
import { MARGIN, partDrawing } from "@/lib/drawing/layout";
import { drawingSummary } from "@/lib/drawing/summary";

// The MCP tools (plan §6). They run as the member who owns the token, with the same rules and
// history as the UI (via = "mcp"). Every write previews first and applies only with the
// confirm_token from its preview; changes to more than 50 parts also need confirm_large.

const { parts, systems, robots, partFiles, partGroups, groupMembers, inventoryItems, inventoryMoves, inventoryLocations } = schema;

const LARGE = 50;
const uuid = z.guid(); // any UUID shape, like isUuid

type Ctx = { member: Member; aiName?: string };
type Planned = { preview: unknown; count: number; summary?: string; apply: () => Promise<unknown> };

type Tool = {
  name: string;
  description: string;
  input: z.ZodObject;
  write?: boolean;
  run: (args: never, ctx: Ctx) => Promise<unknown>;
};

const tools: Tool[] = [];
function read<S extends z.ZodObject>(name: string, description: string, input: S, run: (args: z.infer<S>, ctx: Ctx) => Promise<unknown>) {
  tools.push({ name, description, input, run: run as Tool["run"] });
}
function write<S extends z.ZodObject>(
  name: string,
  description: string,
  input: S,
  plan: (args: z.infer<S>, ctx: Ctx) => Promise<Planned>,
) {
  tools.push({
    name,
    description: `${description} Preview first: call without confirm_token to see exactly what would change, then call again with the same arguments and the confirm_token from the preview to apply it. More than ${LARGE} parts also needs confirm_large: true.`,
    input: input.extend({
      ai_name: z.string().trim().min(1).max(60).describe("Your own name, e.g. 'Claude Opus 5.5'. Shown to the team on To Review and AI logs instead of 'AI'."),
      confirm_token: z.string().optional().describe("From this tool's preview, to apply the change."),
      confirm_large: z.boolean().optional().describe(`Required with confirm_token when more than ${LARGE} parts change.`),
    }),
    write: true,
    run: (async (allArgs: z.infer<S> & { ai_name: string; confirm_token?: string; confirm_large?: boolean }, member: Ctx) => {
      // The AI's name labels the action but isn't part of what the member confirms.
      const { ai_name: aiName, ...args } = allArgs;
      const ctx: Ctx = { ...member, aiName };
      const planned = await plan(args as z.infer<S>, ctx);
      if (!args.confirm_token) {
        return {
          preview: planned.preview,
          count: planned.count,
          confirm_token: planned.count ? confirmToken(ctx.member.id, name, args) : null,
          next: planned.count
            ? `Show this to the member. To apply, call ${name} again with the same arguments and this confirm_token${planned.count > LARGE ? " and confirm_large: true" : ""}.`
            : "Nothing would change.",
        };
      }
      if (!checkConfirmToken(args.confirm_token, ctx.member.id, name, args)) {
        throw new ToolError("The confirm_token doesn't match these arguments or has expired. Preview again.");
      }
      if (planned.count > LARGE && !args.confirm_large) {
        throw new ToolError(`This changes ${planned.count} parts. Confirm with the member, then pass confirm_large: true.`);
      }
      const result = await planned.apply();
      // Every applied change shows on the AI logs page.
      const batchId = (result as { batch_id?: unknown } | null)?.batch_id;
      await logAiAction({
        source: "ai",
        tool: name,
        memberId: ctx.member.id,
        aiName,
        batchId: typeof batchId === "string" ? batchId : null,
        parts: planned.count,
        summary: planned.summary ?? `Applied to ${planned.count} ${planned.count === 1 ? "item" : "items"}`,
      }).catch((err) => console.error("AI log failed", err));
      return result;
    }) as Tool["run"],
  });
}

export class ToolError extends Error {}

// ---------- helpers ----------

const nameOf = (p: { displayName: string | null; onshapeName: string | null; partNumber: string | null }) => {
  const name = p.displayName ?? p.onshapeName ?? "Unnamed part";
  return p.partNumber ? `${p.partNumber} ${name}` : name;
};
const machineName = (id: string | null) => (id ? (getMachine(id)?.name ?? id) : null);

// Machines may be given by name ("CNC") or id ("cnc").
function machineId(value: string | null | undefined) {
  if (value == null || value === "") return value === "" ? null : value;
  const m = getMachine(value) ?? findMachineByName(value);
  if (!m) throw new ToolError(`Unknown machine "${value}". Use list_machines for the exact names.`);
  return m.id;
}

function normaliseChanges(input: Record<string, unknown>): PartChanges {
  const c = { ...input };
  for (const f of ["preProcess", "process1", "process2"]) if (f in c) c[f] = machineId(c[f] as string | null);
  const parsed = partChangesSchema.safeParse(c);
  if (!parsed.success) throw new ToolError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

function summarise(p: typeof parts.$inferSelect & { systemName?: string }) {
  return {
    id: p.id,
    name: nameOf(p),
    system: p.systemName,
    type: p.classification,
    quantity: p.quantity,
    material: p.material,
    onshape_material: p.geometry?.onshapeMaterial ?? null,
    body_type: p.geometry?.bodyType ?? null,
    size_mm: p.geometry?.bbox ?? null,
    // Bent sheet uses the plate materials: sheet_metal is Onshape sheet metal (it has a flat
    // pattern), wall_mm the measured sheet thickness of a flat or bent thin wall.
    sheet_metal: !!p.geometry?.sheetMetal,
    wall_mm: p.geometry?.wallMm ?? null,
    // The stock shape read from the 3D model (hex, box-tube, round-tube, rod, spacer, plate, block).
    shape: p.geometry?.shape ?? null,
    pre_process: machineName(p.preProcess),
    process_1: machineName(p.process1),
    process_2: machineName(p.process2),
    status: computeStatus(p),
    priority: p.priority,
    deadline: p.deadline,
    inventory_item_id: p.inventoryItemId,
  };
}

// History entries with machine names instead of ids, for previews.
const readable = (c: { field: string; oldValue: unknown; newValue: unknown }) =>
  ["preProcess", "process1", "process2"].includes(c.field)
    ? { field: c.field, from: machineName(c.oldValue as string | null), to: machineName(c.newValue as string | null) }
    : { field: c.field, from: c.oldValue, to: c.newValue };

// ---------- reference ----------

read("list_statuses", "The part statuses, in board order, with which count as done. COTS parts use cots_statuses instead.", z.object({}), async () => ({
  statuses: STATUSES.map((s) => ({ name: s.name, done: "done" in s && !!s.done })),
  cots_statuses: COTS_STATUSES.map((s) => s.name),
}));
read("list_machines", "The team's machines with their stage and the CAD file each needs.", z.object({}), async () =>
  MACHINES.map((m) => ({ id: m.id, name: m.name, stage: m.stage, cad_format: m.cadFormat })),
);
read(
  "list_materials",
  "A part's material is an inventory item. These are the Raw Stock items (plates, tubes, shaft stock, filament) by inventory category, with their stock. Pass an item's id to set_up_parts as material_item_id. Other inventory items can be materials too: find them with search_inventory.",
  z.object({}),
  async () =>
    (await listMaterialGroups())
      .filter((g) => g.raw)
      .map((g) => ({ category: g.id, label: g.label, items: g.items.map((i) => ({ id: i.id, name: i.name, label: i.label, in_stock: i.stock })) })),
);

// ---------- read ----------

read("list_robots", "Robots with their completion.", z.object({}), async () =>
  (await listRobots()).map((r) => ({
    id: r.id,
    name: r.name,
    year: r.year,
    archived: r.archived,
    done: r.breakdown.done,
    total: r.breakdown.total,
    percent: r.breakdown.percent,
  })),
);

read("list_systems", "A robot's systems with their completion.", z.object({ robot_id: uuid }), async ({ robot_id }) => {
  const rows = await db.select().from(systems).where(eq(systems.robotId, robot_id)).orderBy(asc(systems.name));
  const live = await db
    .select()
    .from(parts)
    .where(and(inArray(parts.systemId, rows.length ? rows.map((s) => s.id) : [robot_id]), isNull(parts.removedFromCadAt)));
  return rows.map((s) => {
    const b = statusBreakdown(live.filter((p) => p.systemId === s.id));
    return { id: s.id, name: s.name, assembly_url: s.assemblyUrl, last_synced_at: s.lastSyncedAt, done: b.done, total: b.total };
  });
});

read(
  "find_parts",
  "Search BOM parts. All filters are optional and combine. Returns at most `limit` parts (default 200).",
  z.object({
    robot_id: uuid.optional(),
    system_id: uuid.optional(),
    text: z.string().optional().describe("Matches name, part number or description."),
    status: z.string().optional(),
    type: z.enum(["inhouse", "cots", "external", "undefined"]).optional(),
    machine: z.string().optional().describe("Machine name or id in any process slot."),
    material: z.string().optional().describe("Substring of the BOM material."),
    onshape_material: z.string().optional().describe("Substring of Onshape's own material, e.g. 'aluminum'."),
    body_type: z.string().optional().describe("Onshape body type, e.g. 'sheet' or 'solid'."),
    missing_file: z.enum(["drawing", "gcode", "image", "flattened"]).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  }),
  async (f) => {
    const where = [isNull(parts.removedFromCadAt)];
    if (f.system_id) where.push(eq(parts.systemId, f.system_id));
    if (f.robot_id) where.push(eq(systems.robotId, f.robot_id));
    if (f.type) where.push(eq(parts.classification, f.type));
    if (f.material) where.push(ilike(parts.material, `%${f.material}%`));
    if (f.onshape_material) where.push(sql`${parts.geometry}->>'onshapeMaterial' ilike ${`%${f.onshape_material}%`}`);
    if (f.body_type) where.push(sql`${parts.geometry}->>'bodyType' = ${f.body_type}`);
    if (f.text) {
      const t = `%${f.text}%`;
      where.push(sql`(${parts.displayName} ilike ${t} or ${parts.onshapeName} ilike ${t} or ${parts.partNumber} ilike ${t} or ${parts.description} ilike ${t})`);
    }
    if (f.machine) {
      const m = machineId(f.machine)!;
      where.push(sql`${m} in (${parts.preProcess}, ${parts.process1}, ${parts.process2})`);
    }
    let rows = (
      await db
        .select({ part: parts, systemName: systems.name })
        .from(parts)
        .innerJoin(systems, eq(systems.id, parts.systemId))
        .where(and(...where))
        .orderBy(asc(systems.name), asc(parts.partNumber), asc(parts.onshapeName))
    ).map((r) => ({ ...r.part, systemName: r.systemName }));
    if (f.status) rows = rows.filter((p) => computeStatus(p).toLowerCase() === f.status!.toLowerCase());
    if (f.missing_file) {
      const has = new Set(
        (
          await db
            .select({ partId: partFiles.partId })
            .from(partFiles)
            .where(eq(partFiles.type, f.missing_file))
        ).map((r) => r.partId),
      );
      rows = rows.filter((p) => !has.has(p.id) && !(f.missing_file === "drawing" && p.drawingUrl));
    }
    const limit = f.limit ?? 200;
    return { total: rows.length, parts: rows.slice(0, limit).map(summarise), truncated: rows.length > limit };
  },
);

read("get_part", "One part with every field, its files, groups and recent history.", z.object({ part_id: uuid }), async ({ part_id }) => {
  const [row] = await db
    .select({ part: parts, systemName: systems.name })
    .from(parts)
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .where(eq(parts.id, part_id));
  if (!row) throw new ToolError("No such part.");
  const [files, groups, history] = await Promise.all([
    db.select({ type: partFiles.type, filename: partFiles.filename }).from(partFiles).where(eq(partFiles.partId, part_id)),
    db
      .select({ id: partGroups.id, name: partGroups.name })
      .from(groupMembers)
      .innerJoin(partGroups, eq(partGroups.id, groupMembers.groupId))
      .where(eq(groupMembers.partId, part_id)),
    db
      .select()
      .from(schema.partHistory)
      .where(eq(schema.partHistory.partId, part_id))
      .orderBy(sql`${schema.partHistory.at} desc`)
      .limit(20),
  ]);
  return {
    ...summarise({ ...row.part, systemName: row.systemName }),
    description: row.part.description,
    note: row.part.note,
    designer: row.part.designerName,
    fabricators: row.part.fabricators,
    done: { pre_process: row.part.donePreprocess, process_1: row.part.doneProcess1, process_2: row.part.doneProcess2 },
    geometry: row.part.geometry,
    overridden_fields: row.part.overriddenFields,
    drawing_url: row.part.drawingUrl,
    files,
    groups,
    history: history.map((h) => ({ field: h.field, from: h.oldValue, to: h.newValue, via: h.via, at: h.at, batch_id: h.batchId })),
  };
});

read("system_stats", "A system's completion and count per status.", z.object({ system_id: uuid }), async ({ system_id }) => {
  const live = await db.select().from(parts).where(and(eq(parts.systemId, system_id), isNull(parts.removedFromCadAt)));
  const b = statusBreakdown(live);
  return { done: b.done, total: b.total, percent: b.percent, statuses: b.statuses.filter((s) => s.count).map(({ name, count }) => ({ name, count })) };
});

read(
  "search_inventory",
  "Inventory items with stock, category and specs (use them to match BOM parts to items when setting up parts: pass the id to set_up_parts as inventory_item_id). All active robots share one shelf: need is what every robot's linked parts need together, short what the stock doesn't cover, free what no part needs. Sheet items (plates) count sheets and pieces (2.75 = 2 ¾ sheets) and have no need. season_need is a separate shelf target for the season (season_short what the stock is under it); on_order is the status of a COTS card already ordering it.",
  z.object({ text: z.string().optional() }),
  async ({ text }) => {
    const { items } = await listInventory();
    return items
      .filter((i) => !text || i.name.toLowerCase().includes(text.toLowerCase()))
      .map((i) => ({
        id: i.id,
        name: i.name,
        in_stock: i.inStock,
        in_stock_text: formatStock(i.inStock, i.sheet),
        sheet: i.sheet,
        need: i.usage?.need ?? 0,
        short: i.usage?.short ?? 0,
        season_need: i.seasonNeed,
        season_short: hasSeasonNeed(i) ? missing(i, "season") : 0,
        on_order: i.openOrder?.status ?? null,
        free: i.usage?.free ?? i.inStock,
        category: i.category,
        specs: i.specs,
        product_link: i.cotsLinks[0]?.url ?? null,
        has_image: Boolean(i.imagePath),
        image_path: i.imagePath,
        per_robot: i.usage?.robots.map((r) => ({ robot: r.robotName, needed: r.needed, covered: r.allocated })) ?? [],
      }));
  },
);

read(
  "search_online_products",
  "Search the vendors' stores (WCP, AndyMark, ThriftyBot, SDS, CTRE and more) and the wider web for a product, the same search as the inventory's product search. Each result is one store's offer with its page, price in US dollars and picture. Stores that can't be searched (REV, Redux, VEX...) come back as search links under elsewhere. Use the exact product or variant page with link_inventory_products.",
  z.object({ query: z.string().trim().min(3).max(80).describe("In English works best, e.g. '4in Colson wheel 1/2 hex'.") }),
  async ({ query }) => {
    const { groups, elsewhere } = await searchProducts(query);
    return {
      results: groups.flatMap((g) => g.offers.map((o) => ({ title: o.title, url: o.url, site: o.vendor, price: o.price, imageUrl: o.image ?? g.image }))),
      elsewhere,
    };
  },
);

// ---------- write ----------

const changesInput = z
  .object({
    classification: z.enum(["inhouse", "cots", "external", "undefined"]).optional(),
    material: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    preProcess: z.string().nullable().optional().describe("Machine name or id, or null."),
    process1: z.string().nullable().optional().describe("Machine name or id, or null."),
    process2: z.string().nullable().optional().describe("Machine name or id, or null."),
    status: z.string().optional().describe("A name from list_statuses. Resets the done counters."),
    priority: z.enum(PRIORITIES).optional(),
    deadline: z.string().nullable().optional().describe("YYYY-MM-DD"),
    designerName: z.string().nullable().optional(),
    fabricators: z.record(z.string(), z.string()).optional().describe("Per slot: preProcess, process1, process2."),
    note: z.string().nullable().optional(),
    donePreprocess: z.number().int().min(0).optional(),
    doneProcess1: z.number().int().min(0).optional(),
    doneProcess2: z.number().int().min(0).optional(),
    estMinutes: z.number().int().min(0).nullable().optional(),
    actualMinutes: z.number().int().min(0).nullable().optional(),
    inventoryItemId: z.string().nullable().optional().describe("Tie the part to an inventory item (search_inventory)."),
  })
  .describe("Only the fields to change.");

write(
  "update_parts",
  "Change fields on one or more parts, the same as the BOM's editors and Bulk edit.",
  z.object({ part_ids: z.array(uuid).min(1).max(1000), changes: changesInput }),
  async ({ part_ids, changes }, { member, aiName }) => {
    const normal = normaliseChanges(changes);
    const rows = await db.select().from(parts).where(inArray(parts.id, part_ids));
    if (rows.length !== new Set(part_ids).size) throw new ToolError("Some part ids don't exist.");
    const diffs = rows
      .map((p) => ({ part: nameOf(p), id: p.id, changes: planPartUpdate(p, normal, "mcp").history }))
      .filter((d) => d.changes.length);
    const fields = [...new Set(diffs.flatMap((d) => d.changes.map((c) => c.field)))];
    return {
      count: diffs.length,
      summary: `Changed ${fields.join(", ") || "nothing"} on ${diffs.length} ${diffs.length === 1 ? "part" : "parts"}`,
      preview: diffs.map((d) => ({ id: d.id, part: d.part, changes: d.changes.map(readable) })),
      apply: async () => {
        // Changed fields wait in To Review for the designer, like set_up_parts.
        const { batchId, changed } = await applySuggestions(
          part_ids.map((id) => ({ id, changes: normal, reason: null })),
          { memberId: member.id, source: "ai", via: "mcp", aiName },
        );
        return { changed, batch_id: batchId, undo: `undo_batch with batch_id ${batchId}`, next: "The changed parts also wait in To Review for their designer." };
      },
    };
  },
);

// ---------- To Review ----------

read(
  "parts_to_set_up",
  "A robot's CAD parts that have no material or no processes and aren't waiting in To Review, with their size (size_mm: the 3D model's extents, smallest first, so a flat plate's thickness is size_mm[0]; for bent sheet, such as an angle or U channel, use wall_mm, and sheet_metal says Onshape can flatten it), the site's own setup guess (site_guess) where its rules can tell, and auto-link's guess of the inventory item it is (link_guess: score 0-100 and why). Configuring a part always includes linking it to its inventory item: a COTS part to the item it is, an in-house part to the Raw Stock item it's cut from. Match by name, sizes and specs, material and picture (search_inventory for items with their specs; inventory_to_link's item list) and pass inventory_item_id to set_up_parts. Sizes need the robot's 3D model to be built.",
  z.object({ robot_id: uuid, system_id: uuid.optional(), limit: z.number().int().min(1).max(500).optional() }),
  async ({ robot_id, system_id, limit = 200 }) => {
    const rows = await partsToSetUp(robot_id, system_id);
    const shown = rows.slice(0, limit);
    const { found, names } = await findLinks({ partIds: shown.map((r) => r.part.id) });
    const links = new Map(found.map((f) => [f.partId, f]));
    return {
      total: rows.length,
      parts: shown.map(({ part, guess }) => {
        const hit = links.get(part.id);
        return {
          ...summarise(part),
          site_guess: guess ? { ...guess.changes, reason: guess.reason } : null,
          link_guess: hit ? { item_id: hit.itemId, item: names.get(hit.itemId), score: hit.score, why: hit.why } : null,
        };
      }),
      truncated: rows.length > limit,
    };
  },
);

const setupInput = z.object({
  part_id: uuid,
  type: z.enum(["inhouse", "cots", "external", "undefined"]).optional(),
  material_item_id: uuid.optional().describe("The inventory item the part is made from: an id from list_materials (or search_inventory). Sets the part's material to its name."),
  material: z.string().optional().describe("Instead of material_item_id: an exact item name from list_materials, when only one item has it."),
  inventory_item_id: uuid
    .nullable()
    .optional()
    .describe(
      "The inventory item this part is: for a COTS part the item itself (a motor, a bearing), for an in-house part the Raw Stock item it's made from (then it is the material too, like material_item_id). Match it by the part's name, sizes and specs, material and picture. null unlinks. Left out, the site's auto-link suggests one (it waits in To Review).",
    ),
  pre_process: z.string().nullable().optional().describe("Machine name or id, or null."),
  process_1: z.string().nullable().optional().describe("Machine name or id, or null."),
  process_2: z.string().nullable().optional().describe("Machine name or id, or null."),
  reason: z.string().min(1).max(500).describe("One short sentence for the designer: why this material and these processes."),
});

write(
  "set_up_parts",
  "Set the material, processes, type and inventory item you worked out for parts (each part can differ). Always link each part to its inventory item too (inventory_item_id: COTS parts to the item they are, in-house parts to their Raw Stock item); parts you leave without one get auto-link's suggestion. The parts change at once and wait in To Review, where their designer approves or rejects each one; Reject puts the old values back. Use this, not update_parts, for setups you inferred yourself.",
  z.object({ parts: z.array(setupInput).min(1).max(500) }),
  async ({ parts: input }, { member, aiName }) => {
    const stock = await listRawStock();
    const wanted = input.flatMap((e) => [e.material_item_id, e.inventory_item_id].filter((id): id is string => !!id && !stock.some((i) => i.id === id)));
    const others = wanted.length ? await db.select({ id: inventoryItems.id, name: inventoryItems.name }).from(inventoryItems).where(inArray(inventoryItems.id, wanted)) : [];
    const current = await db.select({ id: parts.id, classification: parts.classification }).from(parts).where(inArray(parts.id, input.map((e) => e.part_id)));
    const findItem = (id: string) => {
      const item = stock.find((i) => i.id === id) ?? others.find((i) => i.id === id);
      if (!item) throw new ToolError(`No inventory item ${id}. Use list_materials, search_inventory or inventory_to_link.`);
      return item;
    };
    // The material is an inventory item: the part gets its name and its id.
    const itemFor = (e: (typeof input)[number]) => {
      if (e.material_item_id && e.inventory_item_id && e.material_item_id !== e.inventory_item_id) {
        throw new ToolError("Pass one item per part: material_item_id and inventory_item_id differ.");
      }
      if (e.material_item_id) return findItem(e.material_item_id);
      // An in-house part's item is its material (a Raw Stock item is too, unless the part is COTS).
      if (e.inventory_item_id) {
        const type = e.type ?? current.find((p) => p.id === e.part_id)?.classification;
        const raw = stock.some((i) => i.id === e.inventory_item_id);
        if (type === "inhouse" || (raw && type !== "cots")) return findItem(e.inventory_item_id);
      }
      if (e.material === undefined) return undefined;
      const named = stock.filter((i) => i.name === e.material);
      if (named.length !== 1) {
        throw new ToolError(
          named.length ? `Several items are named "${e.material}"; pass material_item_id.` : `Unknown material "${e.material}". Use list_materials for the items and their ids.`,
        );
      }
      return named[0];
    };
    const edits = input.map((e) => {
      const item = itemFor(e);
      const changes = normaliseChanges(
        Object.fromEntries(
          Object.entries({
            classification: e.type,
            material: item?.name,
            inventoryItemId: item ? item.id : e.inventory_item_id === null ? null : e.inventory_item_id ? findItem(e.inventory_item_id).id : undefined,
            preProcess: e.pre_process,
            process1: e.process_1,
            process2: e.process_2,
          }).filter(
            ([, v]) => v !== undefined,
          ),
        ),
      );
      return { id: e.part_id, changes, reason: e.reason };
    });
    const ids = [...new Set(edits.map((e) => e.id))];
    if (ids.length !== edits.length) throw new ToolError("Each part may appear once.");
    const rows = await db.select().from(parts).where(inArray(parts.id, ids));
    if (rows.length !== ids.length) throw new ToolError("Some part ids don't exist.");
    const byId = new Map(edits.map((e) => [e.id, e]));
    const diffs = rows
      .map((p) => ({ id: p.id, part: nameOf(p), reason: byId.get(p.id)!.reason, changes: planPartUpdate(p, byId.get(p.id)!.changes, "mcp").history }))
      .filter((d) => d.changes.length);
    return {
      count: diffs.length,
      summary: `Set up ${diffs.length} ${diffs.length === 1 ? "part" : "parts"}: ${[...new Set(diffs.map((d) => d.reason))].slice(0, 3).join(" / ")}`,
      preview: diffs.map((d) => ({ id: d.id, part: d.part, changes: d.changes.map(readable), reason: d.reason })),
      apply: async () => {
        const { batchId, changed } = await applySuggestions(edits, { memberId: member.id, source: "ai", via: "mcp", aiName });
        // Parts given no item get auto-link's suggestion (in-house parts are linked through their material).
        const unlinked = input.filter((e) => e.inventory_item_id === undefined && !e.material_item_id && e.material === undefined).map((e) => e.part_id);
        const auto_linked = unlinked.length ? await autoLink({ partIds: unlinked }, { memberId: member.id, via: "mcp" }) : 0;
        return { changed, batch_id: batchId, auto_linked, next: "The parts now wait in the robot's To Review page for their designer." };
      },
    };
  },
);

write(
  "undo_batch",
  "Revert every change in a batch (from any write tool or the UI): part fields, inventory item edits, stock, and items or categories it added (those are removed). Fields edited again since are left alone. The AI logs page's Revert change does the same.",
  z.object({ batch_id: uuid }),
  async ({ batch_id }, { member }) => {
    const [plan, moves, itemEdits, cats] = await Promise.all([
      planUndo(batch_id),
      db.select({ itemId: inventoryMoves.itemId, delta: inventoryMoves.delta }).from(inventoryMoves).where(eq(inventoryMoves.batchId, batch_id)),
      db
        .select({ itemId: schema.inventoryItemHistory.itemId, field: schema.inventoryItemHistory.field })
        .from(schema.inventoryItemHistory)
        .where(eq(schema.inventoryItemHistory.batchId, batch_id)),
      db.select({ id: schema.inventoryCategories.id }).from(schema.inventoryCategories).where(eq(schema.inventoryCategories.batchId, batch_id)),
    ]);
    if (!plan && !moves.length && !itemEdits.length && !cats.length) throw new ToolError("No changes with that batch id.");
    const reverts = plan?.reverts ?? [];
    return {
      count: new Set(reverts.map((r) => r.partId)).size + moves.length + new Set(itemEdits.map((e) => e.itemId)).size + cats.length,
      preview: {
        revert: reverts.map((r) => ({ part_id: r.partId, field: r.field, from: r.from, to: r.to })),
        left_alone_because_edited_since: (plan?.skipped ?? []).map((r) => ({ part_id: r.partId, field: r.field })),
        stock: moves.map((m) => ({ item_id: m.itemId, take_back: m.delta })),
        inventory_items: itemEdits.map((e) => ({ item_id: e.itemId, revert: e.field === "created" ? "remove the item" : e.field })),
        remove_categories: cats.map((c) => c.id),
      },
      apply: async () => {
        const r = await revertAiBatch(batch_id, member.id, "mcp");
        return { batch_id: r.batchId, reverted: r.reverted, result: r.message };
      },
    };
  },
);

write(
  "add_manual_part",
  "Add a part that isn't in CAD to a system's BOM.",
  z.object({
    system_id: uuid,
    name: z.string().min(1),
    quantity: z.number().int().min(0).default(1),
    material: z.string().optional(),
    description: z.string().optional(),
    preProcess: z.string().optional(),
    process1: z.string().optional(),
    process2: z.string().optional(),
  }),
  async (a, { member }) => {
    const [system] = await db.select({ name: systems.name }).from(systems).where(eq(systems.id, a.system_id));
    if (!system) throw new ToolError("No such system.");
    const values = {
      systemId: a.system_id,
      isManual: true,
      displayName: a.name,
      quantity: a.quantity,
      material: a.material ?? null,
      description: a.description ?? null,
      preProcess: machineId(a.preProcess) ?? null,
      process1: machineId(a.process1) ?? null,
      process2: machineId(a.process2) ?? null,
      lastModifiedBy: member.id,
    };
    return {
      count: 1,
      preview: { system: system.name, ...values },
      apply: async () => {
        const [p] = await db.insert(parts).values(values).returning({ id: parts.id });
        return { part_id: p.id };
      },
    };
  },
);

write(
  "group_parts",
  "Bundle parts of one robot into a new part group, or add them to an existing group (group_id).",
  z.object({ part_ids: z.array(uuid).min(1), name: z.string().optional(), group_id: uuid.optional(), color: z.string().optional() }),
  async (a) => {
    const rows = await db
      .select({ part: parts, robotId: systems.robotId })
      .from(parts)
      .innerJoin(systems, eq(systems.id, parts.systemId))
      .where(inArray(parts.id, a.part_ids));
    const robotIds = new Set(rows.map((r) => r.robotId));
    if (robotIds.size !== 1) throw new ToolError("Group parts from one robot.");
    const [robotId] = robotIds;
    let group: { id: string; name: string } | undefined;
    if (a.group_id) {
      [group] = await db.select().from(partGroups).where(and(eq(partGroups.id, a.group_id), eq(partGroups.robotId, robotId)));
      if (!group) throw new ToolError("No such group on this robot.");
    } else if (!a.name || rows.length < 2) {
      throw new ToolError("A new group needs a name and two or more parts.");
    }
    return {
      count: rows.length,
      preview: { group: group?.name ?? a.name, new_group: !group, parts: rows.map((r) => nameOf(r.part)) },
      apply: async () => {
        const id =
          group?.id ??
          (
            await db
              .insert(partGroups)
              .values({ robotId, name: a.name!, color: /^#[0-9a-f]{6}$/i.test(a.color ?? "") ? a.color : null })
              .returning({ id: partGroups.id })
          )[0].id;
        await db
          .insert(groupMembers)
          .values(
            rows.map((r) => ({
              groupId: id,
              partId: r.part.id,
              keySnapshot: { did: r.part.sourceDid, eid: r.part.sourceEid, partId: r.part.onshapePartId, name: r.part.onshapeName ?? r.part.displayName },
            })),
          )
          .onConflictDoNothing();
        return { group_id: id };
      },
    };
  },
);

write(
  "set_group_status",
  "Set one status on every member of a part group that is still on the BOM.",
  z.object({ group_id: uuid, status: z.string() }),
  async ({ group_id, status }, { member }) => {
    const normal = normaliseChanges({ status });
    const rows = await db
      .select({ part: parts })
      .from(groupMembers)
      .innerJoin(parts, eq(parts.id, groupMembers.partId))
      .where(and(eq(groupMembers.groupId, group_id), isNull(parts.removedFromCadAt)));
    const changing = rows.filter((r) => planPartUpdate(r.part, normal, "mcp").history.length);
    return {
      count: changing.length,
      preview: changing.map((r) => ({ part: nameOf(r.part), from: computeStatus(r.part), to: normal.status })),
      apply: async () => {
        const { batchId, changed } = await applyPartChanges(
          rows.map((r) => r.part.id),
          normal,
          { memberId: member.id, via: "mcp" },
        );
        return { changed, batch_id: batchId };
      },
    };
  },
);

write(
  "adjust_stock",
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
        const [item] = await tx
          .insert(inventoryItems)
          .values({ name: a.name, cotsLinks: a.product_url ? [{ url: a.product_url, site: vendorOfUrl(a.product_url) }] : [] })
          .returning({ id: inventoryItems.id });
        const ctx = { memberId: member.id, via: "mcp" as const, aiName, batchId };
        await recordItemChanges(tx, item.id, null, { name: a.name }, ctx);
        await moveStock(tx, { itemId: item.id, delta: a.in_stock, reason: "counted" }, ctx);
        return item.id;
      });
      const auto_linked = await autoLink({ itemIds: [id] }, { memberId: member.id, via: "mcp" });
      return { item_id: id, batch_id: batchId, auto_linked };
    },
  }),
);

read(
  "list_inventory_categories",
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
  "COTS parts on active robots that aren't linked to an inventory item yet, with the item the site's auto-link thinks each one is (score 0-100 and why: same Onshape part or product link, sizes and words in the name, same picture as a linked part) and a compact list of every item, so you can match the rest. Suggest links with link_inventory; they wait in To Review.",
  z.object({ robot_id: uuid.optional(), limit: z.number().int().min(1).max(500).optional() }),
  async ({ robot_id, limit = 200 }) => {
    const [rows, items] = await Promise.all([
      db
        .select({ part: parts, systemName: systems.name, robotId: robots.id, robotName: robots.name })
        .from(parts)
        .innerJoin(systems, eq(systems.id, parts.systemId))
        .innerJoin(robots, eq(robots.id, systems.robotId))
        .where(and(isNull(parts.inventoryItemId), isNull(parts.removedFromCadAt), eq(parts.classification, "cots"), eq(robots.archived, false), robot_id ? eq(robots.id, robot_id) : undefined)),
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
  "Add several items to the team inventory at once, e.g. from a spreadsheet, an order email or a photo of a shelf the member shares with you. New items are added at once (not to To Review) and show in AI logs, where they can be reverted. in_stock for sheet categories can have pieces (2.75 = 2 ¾ sheets). location is a shelf or bin name; a new name is created. BOM parts with the same product link or Onshape part are linked to the new items and wait in To Review.",
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
            const [item] = await tx.insert(inventoryItems).values({ name: p.input.name, locationId, ...p.values }).returning({ id: inventoryItems.id });
            const ctx = { memberId: member.id, via: "mcp" as const, aiName, batchId };
            await recordItemChanges(tx, item.id, null, { name: p.input.name }, ctx);
            await moveStock(tx, { itemId: item.id, delta: p.input.in_stock, reason: "counted" }, ctx);
            out.push(item.id);
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
  "Edit existing inventory items (each item can differ): rename them (name), move them to another category or location, and fill in specs, product link, price, picture and season need. Name, category, specs, location and season need apply at once and wait in To Review's Inventory section with your name until a member approves (Reject puts the old values back). Product link, price and picture apply at once without To Review, and linked COTS cards follow. A new product_url replaces the item's link from the same store. Any product_url, even one the item already has, re-reads the page for its picture: for a Shopify family page (AndyMark, WCP, ThriftyBot) the variant is picked from ?variant= or the item's name and specs (color, durometer, teeth, bore, size), and the link becomes that variant's. image_url saves that exact picture instead; refresh_photo: true re-reads the item's current link without giving one, false skips the picture. REV and Redux pages can't be read per variant: pass image_url for them. Specs must use the category's fields and choices from list_inventory_categories. BOM parts with the same product link are then linked to the item and wait in To Review.",
  z.object({
    items: z
      .array(
        itemInfo.extend({
          item_id: uuid,
          name: z.string().trim().min(1).max(200).optional().describe("A new name for the item."),
          location: z.string().trim().min(1).max(100).optional().describe("The shelf or bin it moves to; a new name is created."),
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

write(
  "update_bom_from_onshape",
  "Pull a system's BOM from Onshape with the member's Onshape account and commit every change as the system's next version (in the app, Update System shows the changes to commit first).",
  z.object({ system_id: uuid }),
  async ({ system_id }, { member }) => {
    const [system] = await db.select().from(systems).where(eq(systems.id, system_id));
    if (!system) throw new ToolError("No such system.");
    if (!member.onshapeConnected) throw new ToolError("Connect Onshape on your OrbitParts profile first.");
    return {
      count: 1,
      preview: { system: system.name, assembly: system.assemblyUrl, note: "Uses a few of your Onshape API calls." },
      apply: async () => {
        try {
          const started = Date.now();
          const s = await updateBomFromOnshape(system_id, member.id, { force: true });
          const t = await refreshThumbnails(system_id, member.id, started + 45_000);
          return { ...s, thumbnails: t.fetched, thumbnail_errors: t.failed ? `${t.failed} failed: ${t.error}` : undefined, calls: s.calls + t.calls };
        } catch (err) {
          if (err instanceof OnshapeError) throw new ToolError(err.message);
          throw err;
        }
      },
    };
  },
);

// ---------- drawings ----------

read(
  "get_drawing",
  "A part's fabrication drawing: the stock it's read as (plate, square tube, hex shaft or round tube), its exact sizes, every hole with any tap or bearing it matches, and the drawing's notes. Drawings only note taps (Ø4.2 = M5 tapped) and fits; other holes get no note.",
  z.object({ part_id: uuid }),
  async ({ part_id }) => {
    const d = await loadDrawing(part_id);
    if (!d) throw new ToolError("This part has no drawing yet. Make one with create_drawings.");
    return { part: d.title.name, outdated: d.outdated, ...drawingSummary(d.drawing.part, d.drawing.edits, d.title) };
  },
);

write(
  "create_drawings",
  "Make fabrication drawings for parts of one system from their exact Onshape geometry (2 Onshape calls per Part Studio, with the member's account). Plates, square tubes, hex shafts and round tubes get one; other parts are skipped. Notes added in the editor are kept.",
  z.object({ system_id: uuid, part_ids: z.array(uuid).min(1).max(200) }),
  async ({ system_id, part_ids }, { member }) => {
    const rows = await db
      .select({ id: parts.id, displayName: parts.displayName, onshapeName: parts.onshapeName, partNumber: parts.partNumber })
      .from(parts)
      .where(and(eq(parts.systemId, system_id), inArray(parts.id, part_ids)));
    if (!member.onshapeConnected) throw new ToolError("Connect Onshape on your OrbitParts profile first.");
    return {
      count: rows.length,
      summary: `Made drawings for ${rows.length} ${rows.length === 1 ? "part" : "parts"}`,
      preview: { parts: rows.map(nameOf), note: "Uses 2 of your Onshape API calls per Part Studio." },
      apply: async () => {
        try {
          const s = await makeDrawings(system_id, rows.map((r) => r.id), member.id, Date.now() + 45_000);
          return { made: s.made.length, skipped: s.skipped, left_for_next_call: s.left };
        } catch (err) {
          if (err instanceof OnshapeError) throw new ToolError(err.message);
          throw err;
        }
      },
    };
  },
);

write(
  "edit_drawing",
  "Change a part's drawing notes: add notes (attached to the first hole of hole_diameter_mm, or free), retype or hide existing ones (ids from get_drawing). Fit notes have three lines, like 'light press fit for' / '1/2IN HEX Bearing' / 'Ø28.7', joined by newlines; fits are light press, heavy press, slip, precise slip.",
  z.object({
    part_id: uuid,
    add: z.array(z.object({ text: z.string().min(1).max(300), hole_diameter_mm: z.number().positive().optional() })).max(20).optional(),
    set_text: z.record(z.string(), z.string().max(300)).optional(),
    hide: z.array(z.string()).optional(),
    show: z.array(z.string()).optional(),
  }),
  async ({ part_id, add, set_text, hide, show }) => {
    const d = await loadDrawing(part_id);
    if (!d) throw new ToolError("This part has no drawing yet. Make one with create_drawings.");
    const layout = partDrawing(d.drawing.part, d.title);
    const edits: DrawingEdits = structuredClone(d.drawing.edits ?? {});
    const hidden = new Set(edits.hidden ?? []);
    hide?.forEach((id) => hidden.add(id));
    show?.forEach((id) => hidden.delete(id));
    edits.hidden = [...hidden];
    for (const [id, text] of Object.entries(set_text ?? {})) {
      const added = edits.added?.find((a) => a.id === id);
      if (added) added.text = text;
      else edits.text = { ...edits.text, [id]: text };
    }
    let n = 0;
    for (const a of add ?? []) {
      const hole = a.hole_diameter_mm ? layout.holes.find((h) => Math.abs(h.d - a.hole_diameter_mm!) <= 0.05) : undefined;
      if (a.hole_diameter_mm && !hole) throw new ToolError(`No Ø${a.hole_diameter_mm} hole on this drawing. get_drawing lists its holes.`);
      const id = `ai:${Date.now()}:${n++}`;
      const at: [number, number] = hole
        ? [Math.min(hole.at[0] + hole.r + 14, layout.sheet.w - 60), Math.max(hole.at[1] - hole.r - 14, 16)]
        : [MARGIN + 5, MARGIN + 10 + 8 * n];
      edits.added = [...(edits.added ?? []), { id, text: a.text, at, ...(hole ? { leader: [hole.at[0] + hole.r * 0.7, hole.at[1] - hole.r * 0.7] as [number, number] } : {}) }];
    }
    const changes = (add?.length ?? 0) + Object.keys(set_text ?? {}).length + (hide?.length ?? 0) + (show?.length ?? 0);
    return {
      count: changes ? 1 : 0,
      summary: `Edited the drawing of ${d.title.name}`,
      preview: { part: d.title.name, notes_after: drawingSummary(d.drawing.part, edits, d.title).notes },
      apply: async () => {
        await db.update(schema.partDrawings).set({ edits, updatedAt: new Date() }).where(eq(schema.partDrawings.partId, part_id));
        return { saved: true };
      },
    };
  },
);

// ---------- COTS ----------

const COTS_WORKFLOW =
  "Workflow for each part: find it on FRCDesign.org (FRCDesignLib, the Onshape library the team's COTS models come from), which names the product and its vendor; " +
  "search the web for the product page on the vendor's site and on every other store that sells the same product (WCP, REV, AndyMark, VEX, TTB, SDS, Swyft, goBILDA, McMaster-Carr, …); " +
  "then set_cots_info with the official product name, every product page link (the main vendor first) with its price, and the average price of one at the quantity needed (pack sizes and quantity breaks included). " +
  "Only use pages you actually opened; leave out what you couldn't find.";

read(
  "cots_parts_to_look_up",
  `COTS parts to look up online. The same part in several systems of a robot comes back once, with every part_id and the total quantity. By default only parts missing links or a price. ${COTS_WORKFLOW}`,
  z.object({
    robot_id: uuid.optional(),
    include_done: z.boolean().optional().describe("Also return parts that already have links and a price."),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  async ({ robot_id, include_done, limit = 100 }) => {
    const where = [isNull(parts.removedFromCadAt), eq(parts.classification, "cots"), eq(schema.robots.archived, false)];
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
        status: computeStatus(g[0]),
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

write(
  "set_cots_info",
  `Set COTS parts' official name, product links, average price and filter box, found online. The parts change at once (undo_batch reverts it). ${COTS_WORKFLOW}`,
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

// ---------- MCP plumbing ----------

export function listTools() {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, { io: "input" }),
    annotations: { readOnlyHint: !t.write, destructiveHint: false },
  }));
}

export async function callTool(name: string, args: unknown, ctx: Ctx) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new ToolError(`Unknown tool ${name}.`);
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) throw new ToolError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return tool.run(parsed.data as never, ctx);
}
