import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { effectiveMode, partChangesCapability } from "@/components/shell/mode";
import { COTS_PROCESS } from "@/config/machines";
import { db, schema } from "@/db";
import { autoLink, fastenerLinkProblems, findLinks } from "@/lib/inventory/autolink";
import { listRawStock } from "@/lib/data/materials";
import { applyPartChanges } from "@/lib/parts/apply";
import { planPartUpdate } from "@/lib/parts/changes";
import { planUndo } from "@/lib/parts/undo";
import { applySuggestions, partsToSetUp, revertAiBatch } from "@/lib/review/review";
import { cotsLinkDenied } from "@/lib/parts/cotsLink";
import { fabSetupDenied } from "@/lib/parts/fabSetup";
import { statusChangeDeniedFor } from "@/lib/mode";
import { computeStatus } from "@/lib/status";
import { uuid, read, write, ToolError, nameOf, machineId, normaliseChanges, summarise, readable } from "../registry";

const { parts, systems, partGroups, groupMembers, inventoryItems, inventoryMoves } = schema;

// Setting parts up and To Review: Suggest, material and machines, groups and undo.

read(
  "parts_to_set_up",
  "member",
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
  process_1: z.string().nullable().optional().describe("Machine name or id, or null."),
  process_2: z.string().nullable().optional().describe("The first added process's machine (name or id), or null."),
  reason: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'One short sentence for the designer: why this material and these processes. When no stock item fits the part exactly and you pick the nearest (within 20% of its size; plates: the nearest thicker, else thinner), add "Rounded to nearest: <item size> (part is <part size>)", e.g. "Rounded to nearest: 40 mm tube (part is 41.59 mm)": the part window shows it in amber and the card an ≈ until approved. site_guess does the same.',
    ),
});

write(
  "set_up_parts",
  { cap: ({ parts }) => parts.map((e) => partChangesCapability(e.type === undefined ? {} : { classification: e.type })), destructive: true },
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
    for (const e of edits) {
      const denied = await statusChangeDeniedFor(effectiveMode(member), [e.id], e.changes);
      if (denied) throw new ToolError(denied);
    }
    const rows = await db.select().from(parts).where(inArray(parts.id, ids));
    if (rows.length !== ids.length) throw new ToolError("Some part ids don't exist.");
    const wrong = await fastenerLinkProblems(edits.flatMap((e) => (e.changes.inventoryItemId ? [{ partId: e.id, itemId: e.changes.inventoryItemId }] : [])));
    if (wrong.length) throw new ToolError(`Fasteners link only to the same thread, length and head: ${wrong.slice(0, 20).join("; ")}`);
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
  { cap: "manage", destructive: true },
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
  { cap: "shape", destructive: false },
  "Add a part that isn't in CAD to a system's BOM.",
  z.object({
    system_id: uuid,
    name: z.string().min(1),
    quantity: z.number().int().min(0).default(1),
    material: z.string().optional(),
    description: z.string().optional(),
    process1: z.string().optional().describe("Machine name or id, or \"COTS\"."),
    process2: z.string().optional().describe("A process after Process 1 (machine name or id)."),
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
      process1: a.process1?.trim().toLowerCase() === COTS_PROCESS ? COTS_PROCESS : (machineId(a.process1) ?? null),
      addedProcesses: a.process2 ? [{ machine: machineId(a.process2)!, done: 0, qa: false, qaDone: false }] : [],
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
  { cap: "work", destructive: false },
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
  { cap: "work", destructive: true },
  "Set one status on every member of a part group that is still on the BOM. Released and In Process 1 (or Released P2+ / In Process 2+) land on each part's own process, keeping the processes before it.",
  z.object({ group_id: uuid, status: z.string() }),
  async ({ group_id, status }, { member }) => {
    // Each part takes the status at the process it is at, as To Fab's batch menu does (audit
    // 2026-11-25, FAB-2): a CNC batch's "Released" keeps the laser's count and the QA.
    const plain = status === "Released P2+" ? "Released" : status === "In Process 2+" ? "In Process 1" : status;
    const normal = { ...normaliseChanges({ status: plain }), atProcess: true as const };
    const rows = await db
      .select({ part: parts })
      .from(groupMembers)
      .innerJoin(parts, eq(parts.id, groupMembers.partId))
      .where(and(eq(groupMembers.groupId, group_id), isNull(parts.removedFromCadAt)));
    for (const r of rows) {
      const denied = cotsLinkDenied(r.part, normal) ?? fabSetupDenied(r.part, normal);
      if (denied) throw new ToolError(`${nameOf(r.part)}: ${denied}`);
    }
    const denied = await statusChangeDeniedFor(effectiveMode(member), rows.map((r) => r.part.id), normal);
    if (denied) throw new ToolError(denied);
    const changing = rows.filter((r) => planPartUpdate(r.part, normal, "mcp").history.length);
    return {
      count: changing.length,
      preview: changing.map((r) => ({ part: nameOf(r.part), from: computeStatus(r.part), to: computeStatus({ ...r.part, ...planPartUpdate(r.part, normal, "mcp").set }) })),
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
