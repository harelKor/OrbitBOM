import "server-only";
import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { effectiveMode, partChangesCapability } from "@/components/shell/mode";
import { PRIORITIES } from "@/config/priorities";
import { db, schema } from "@/db";
import { listInventory } from "@/lib/data/inventory";
import { devicesOf } from "@/lib/inventory/devices";
import { searchProducts } from "@/lib/inventory/search";
import { hasSeasonNeed, missing } from "@/lib/inventory/season";
import { formatStockExact as formatStock } from "@/lib/inventory/stock";
import { listRobots } from "@/lib/data/robots";
import { OnshapeError } from "@/lib/onshape/client";
import { refreshPartData } from "@/lib/onshape/thumbnails";
import { planPartUpdate } from "@/lib/parts/changes";
import { applySuggestions } from "@/lib/review/review";
import { cotsLinkDenied } from "@/lib/parts/cotsLink";
import { fabSetupDenied } from "@/lib/parts/fabSetup";
import { statusChangeDeniedFor } from "@/lib/mode";
import { computeStatus } from "@/lib/status";
import { statusBreakdown } from "@/lib/stats";
import { updateBomFromOnshape } from "@/lib/sync/updateBom";
import { uuid, read, write, ToolError, nameOf, machineId, normaliseChanges, summarise, readable } from "../registry";

const { parts, systems, partFiles, partGroups, groupMembers } = schema;

// Robots, systems and parts: reading them, editing them, and pulling a system from Onshape.

read("list_robots", "member", "Robots with their completion.", z.object({}), async () =>
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

read("list_systems", "member", "A robot's systems with their completion.", z.object({ robot_id: uuid }), async ({ robot_id }) => {
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
  "member",
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
    limit: z.number().int().min(1).max(500).optional(),
  }),
  async (f) => {
    const limit = f.limit ?? 200;
    // Status and missing files are worked out here, so only without them can the database stop at the limit.
    const inSql = !f.status && !f.missing_file;
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
      where.push(sql`(${parts.process1} = ${m} or ${parts.addedProcesses} @> ${JSON.stringify([{ machine: m }])}::jsonb)`);
    }
    const query = db
      .select({ part: parts, systemName: systems.name, total: sql<number>`count(*) over ()`.mapWith(Number) })
      .from(parts)
      .innerJoin(systems, eq(systems.id, parts.systemId))
      .where(and(...where))
      .orderBy(asc(systems.name), asc(parts.partNumber), asc(parts.onshapeName));
    const found = await (inSql ? query.limit(limit) : query);
    const total = inSql ? (found[0]?.total ?? 0) : found.length;
    let rows = found.map((r) => ({ ...r.part, systemName: r.systemName }));
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
    const count = inSql ? total : rows.length;
    return { total: count, parts: rows.slice(0, limit).map(summarise), truncated: count > limit };
  },
);

read("get_part", "member", "One part with every field, its files, groups and recent history.", z.object({ part_id: uuid }), async ({ part_id }) => {
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
    done: { process_1: row.part.doneProcess1, ...Object.fromEntries(row.part.addedProcesses.map((a, i) => [`process_${i + 2}`, a.done])) },
    geometry: row.part.geometry,
    overridden_fields: row.part.overriddenFields,
    drawing_url: row.part.drawingUrl,
    files,
    groups,
    history: history.map((h) => ({ field: h.field, from: h.oldValue, to: h.newValue, via: h.via, at: h.at, batch_id: h.batchId })),
  };
});

read("system_stats", "member", "A system's completion and count per status.", z.object({ system_id: uuid }), async ({ system_id }) => {
  const live = await db.select().from(parts).where(and(eq(parts.systemId, system_id), isNull(parts.removedFromCadAt)));
  const b = statusBreakdown(live);
  return { done: b.done, total: b.total, percent: b.percent, statuses: b.statuses.filter((s) => s.count).map(({ name, count }) => ({ name, count })) };
});

read(
  "search_inventory",
  "member",
  "Inventory items with stock, category and specs (use them to match BOM parts to items when setting up parts: pass the id to set_up_parts as inventory_item_id). All active robots share one shelf: need is what every robot's linked parts need together, short what the stock doesn't cover, free what no part needs. Sheet items (plates) count sheets and pieces (2.75 = 2 ¾ sheets) and have no need. season_need is a separate shelf target for the season (season_short what the stock is under it); on_order is the status of a COTS card already ordering it. The PC stations (Scouting PC, CAD PC, Build PC) count their PCs, listed under pcs with each one's name, GPU, CPU, RAM, condition (1-5) and note.",
  z.object({ text: z.string().optional(), limit: z.number().int().min(1).max(500).optional().describe("At most this many items (default 200).") }),
  async ({ text, limit = 200 }) => {
    const { items } = await listInventory();
    const found = items.filter((i) => !text || i.name.toLowerCase().includes(text.toLowerCase()));
    // The PC stations list their PCs (read only here).
    const devices = await devicesOf(found.slice(0, limit).filter((i) => i.station).map((i) => i.id));
    return {
      total: found.length,
      truncated: found.length > limit,
      items: found.slice(0, limit).map((i) => ({
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
        ...(devices.has(i.id) ? { pcs: devices.get(i.id)!.map((d, n) => ({ number: n + 1, name: d.name ?? `PC ${n + 1}`, gpu: d.gpu, cpu: d.cpu, ram: d.ram, condition_out_of_5: d.condition, note: d.note })) } : {}),
      })),
    };
  },
);

read(
  "search_online_products",
  "member",
  "Search the vendors' stores (WCP, AndyMark, ThriftyBot, SDS, CTRE and more) and the wider web for a product, the same search as the inventory's product search. Each result is one store's offer with its page, price in US dollars and picture. Stores that can't be searched (REV, Redux, VEX...) come back as search links under elsewhere. Use the exact product or variant page with link_inventory_products.",
  z.object({ query: z.string().trim().min(3).max(80).describe("In English works best, e.g. '4in Colson wheel 1/2 hex'.") }),
  async ({ query }) => {
    const { groups, elsewhere, web } = await searchProducts(query, { web: true });
    return {
      results: groups.flatMap((g) => g.offers.map((o) => ({ title: o.title, url: o.url, site: o.vendor, price: o.price, imageUrl: o.image ?? g.image }))),
      elsewhere,
      ...(web === "used-up" ? { note: "Today's web searches are used up; only the vendors' stores were searched." } : {}),
    };
  },
);

// ---------- write ----------

const changesInput = z
  .object({
    classification: z.enum(["inhouse", "cots", "external", "undefined"]).optional(),
    material: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    process1: z.string().nullable().optional().describe("Machine name or id, \"COTS\" (bought, then QA, then the added processes), or null."),
    process2: z.string().nullable().optional().describe("The first added process's machine (Onshape's Process 2), or null to take it away."),
    addedProcesses: z
      .array(z.object({ machine: z.string().describe("Machine name or id."), qa: z.boolean().optional().describe("QA is needed before this process starts.") }))
      .max(20)
      .optional()
      .describe("Every process after Process 1, in order (Process 2, 3...). Replaces the list; a process keeps its done count while its machine stays."),
    appendProcess: z.object({ machine: z.string(), qa: z.boolean().optional() }).optional().describe("Add one process after the part's last one."),
    status: z
      .string()
      .optional()
      .describe("A name from list_statuses; Released P2+ / In Process 2+ are given with the process number (\"Released P3\", \"In Process 3\"). Resets the done counters."),
    qa: z.enum(["approve", "reopen"]).optional().describe("Approve the QA the part waits for (CAD): a mid-way QA releases it to its next process, the last one puts it In Stock. reopen takes it back."),
    priority: z.enum(PRIORITIES).optional(),
    deadline: z.string().nullable().optional().describe("YYYY-MM-DD"),
    designerName: z.string().nullable().optional(),
    fabricators: z.record(z.string(), z.string()).optional().describe("Per process: process1, process2, process3..."),
    note: z.string().nullable().optional(),
    doneProcess1: z.number().int().min(0).optional(),
    addedDone: z.array(z.number().int().min(0)).max(20).optional().describe("Done counts of the added processes, in order (Process 2 first)."),
    estMinutes: z.number().int().min(0).nullable().optional(),
    actualMinutes: z.number().int().min(0).nullable().optional(),
    inventoryItemId: z.string().nullable().optional().describe("Tie the part to an inventory item (search_inventory)."),
  })
  .describe("Only the fields to change.");

write(
  "update_parts",
  { cap: ({ changes }) => partChangesCapability(changes), destructive: true },
  "Change fields on one or more parts, the same as the BOM's editors and Bulk edit.",
  z.object({ part_ids: z.array(uuid).min(1).max(1000), changes: changesInput }),
  async ({ part_ids, changes }, { member, aiName }) => {
    const normal = normaliseChanges(changes);
    const rows = await db.select().from(parts).where(inArray(parts.id, part_ids));
    if (rows.length !== new Set(part_ids).size) throw new ToolError("Some part ids don't exist.");
    for (const p of rows) {
      const denied = cotsLinkDenied(p, normal) ?? fabSetupDenied(p, normal);
      if (denied) throw new ToolError(`${nameOf(p)}: ${denied}`);
    }
    // The team's status rules, as the BOM's editors apply them.
    const denied = await statusChangeDeniedFor(effectiveMode(member), part_ids, normal);
    if (denied) throw new ToolError(denied);
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

write(
  "update_bom_from_onshape",
  { cap: "sync", destructive: true },
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
          const s = await updateBomFromOnshape(system_id, member.id, { force: true });
          if (s.skipped === "review")
            return { ...s, note: `Not committed: Onshape's BOM leaves out ${s.removed.length} parts. A member reviews it in the app (Update System) before it's committed.` };
          // Sheet metal and body types for the export files; pictures are drawn from the 3D model.
          const t = await refreshPartData(system_id, member.id);
          return { ...s, calls: s.calls + t.calls };
        } catch (err) {
          if (err instanceof OnshapeError) throw new ToolError(err.message);
          throw err;
        }
      },
    };
  },
);
