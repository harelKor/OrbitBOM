import "server-only";
import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { findMachineByName, getMachine, MACHINES } from "@/config/machines";
import { MATERIALS } from "@/config/materials";
import { STATUSES } from "@/config/statuses";
import { PRIORITIES } from "@/config/priorities";
import { db, schema } from "@/db";
import type { Member } from "@/lib/auth";
import { listInventory } from "@/lib/data/inventory";
import { listRobots } from "@/lib/data/robots";
import { OnshapeError } from "@/lib/onshape/client";
import { refreshThumbnails } from "@/lib/onshape/thumbnails";
import { applyPartChanges } from "@/lib/parts/apply";
import { partChangesSchema, planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { applyUndo, planUndo } from "@/lib/parts/undo";
import { computeStatus } from "@/lib/status";
import { statusBreakdown } from "@/lib/stats";
import { updateBomFromOnshape } from "@/lib/sync/updateBom";
import { checkConfirmToken, confirmToken } from "./confirm";

// The MCP tools (plan §6). They run as the member who owns the token, with the same rules and
// history as the UI (via = "mcp"). Every write previews first and applies only with the
// confirm_token from its preview; changes to more than 50 parts also need confirm_large.

const { parts, systems, partFiles, partGroups, groupMembers, inventoryItems } = schema;

const LARGE = 50;
const uuid = z.guid(); // any UUID shape, like isUuid

type Ctx = { member: Member };
type Planned = { preview: unknown; count: number; apply: () => Promise<unknown> };

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
      confirm_token: z.string().optional().describe("From this tool's preview, to apply the change."),
      confirm_large: z.boolean().optional().describe(`Required with confirm_token when more than ${LARGE} parts change.`),
    }),
    write: true,
    run: (async (args: z.infer<S> & { confirm_token?: string; confirm_large?: boolean }, ctx: Ctx) => {
      const planned = await plan(args, ctx);
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
      return planned.apply();
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

read("list_statuses", "The part statuses, in board order, with which count as done.", z.object({}), async () =>
  STATUSES.map((s) => ({ name: s.name, done: "done" in s && !!s.done })),
);
read("list_machines", "The team's machines with their stage and the CAD file each needs.", z.object({}), async () =>
  MACHINES.map((m) => ({ id: m.id, name: m.name, stage: m.stage, cad_format: m.cadFormat })),
);
read("list_materials", "The team's materials by category. Use these exact names.", z.object({}), async () => MATERIALS);

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
    type: z.enum(["inhouse", "cots", "external"]).optional(),
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
  "Inventory items with stock and how many each robot uses.",
  z.object({ text: z.string().optional() }),
  async ({ text }) => {
    const { items } = await listInventory();
    return items
      .filter((i) => !text || i.name.toLowerCase().includes(text.toLowerCase()))
      .map((i) => ({
        id: i.id,
        name: i.name,
        in_stock: i.inStock,
        used: i.usage?.used ?? 0,
        material: i.material,
        per_robot: i.usage?.robots.map((r) => ({ robot: r.robotName, needed: r.needed, allocated: r.allocated })) ?? [],
      }));
  },
);

// ---------- write ----------

const changesInput = z
  .object({
    classification: z.enum(["inhouse", "cots", "external"]).optional(),
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
  async ({ part_ids, changes }, { member }) => {
    const normal = normaliseChanges(changes);
    const rows = await db.select().from(parts).where(inArray(parts.id, part_ids));
    if (rows.length !== new Set(part_ids).size) throw new ToolError("Some part ids don't exist.");
    const diffs = rows
      .map((p) => ({ part: nameOf(p), id: p.id, changes: planPartUpdate(p, normal, "mcp").history }))
      .filter((d) => d.changes.length);
    return {
      count: diffs.length,
      preview: diffs.map((d) => ({ id: d.id, part: d.part, changes: d.changes.map(readable) })),
      apply: async () => {
        const { batchId, changed } = await applyPartChanges(part_ids, normal, { memberId: member.id, via: "mcp" });
        return { changed, batch_id: batchId, undo: `undo_batch with batch_id ${batchId}` };
      },
    };
  },
);

write(
  "undo_batch",
  "Revert every change in a batch (from update_parts, set_group_status or the UI). Fields edited again since are left alone.",
  z.object({ batch_id: uuid }),
  async ({ batch_id }, { member }) => {
    const plan = await planUndo(batch_id);
    if (!plan) throw new ToolError("No changes with that batch id.");
    return {
      count: new Set(plan.reverts.map((r) => r.partId)).size,
      preview: {
        revert: plan.reverts.map((r) => ({ part_id: r.partId, field: r.field, from: r.from, to: r.to })),
        left_alone_because_edited_since: plan.skipped.map((r) => ({ part_id: r.partId, field: r.field })),
      },
      apply: async () => ({ batch_id: await applyUndo(plan.reverts, member.id, "mcp"), reverted: plan.reverts.length }),
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
  "Add to or take from an inventory item's stock (delta can be negative).",
  z.object({ item_id: uuid, delta: z.number().int() }),
  async ({ item_id, delta }) => {
    const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, item_id));
    if (!item) throw new ToolError("No such inventory item.");
    const to = Math.max(0, item.inStock + delta);
    return {
      count: to === item.inStock ? 0 : 1,
      preview: { item: item.name, in_stock: { from: item.inStock, to } },
      apply: async () => {
        await db
          .update(inventoryItems)
          .set({ inStock: sql`greatest(${inventoryItems.inStock} + ${delta}, 0)` })
          .where(eq(inventoryItems.id, item_id));
        return { item: item.name, in_stock: to };
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
    material: z.string().optional(),
    vendor_url: z.url().optional(),
  }),
  async (a) => ({
    count: 1,
    preview: a,
    apply: async () => {
      const [item] = await db
        .insert(inventoryItems)
        .values({ name: a.name, inStock: a.in_stock, material: a.material ?? null, vendorUrl: a.vendor_url ?? null })
        .returning({ id: inventoryItems.id });
      return { item_id: item.id };
    },
  }),
);

write(
  "update_bom_from_onshape",
  "Pull a system's BOM from Onshape with the member's Onshape account (the same as the Update BOM button).",
  z.object({ system_id: uuid }),
  async ({ system_id }, { member }) => {
    const [system] = await db.select().from(systems).where(eq(systems.id, system_id));
    if (!system) throw new ToolError("No such system.");
    if (!member.onshapeConnected) throw new ToolError("Connect Onshape on your OrbitMech profile first.");
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
