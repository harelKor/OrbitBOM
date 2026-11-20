import "server-only";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { partKey } from "@/lib/model/assembly";
import { builtStudios } from "@/lib/model/build";
import { decodeMeshes } from "@/lib/model/mesh";
import { undoMoves } from "@/lib/inventory/moves";
import { applyEachPartChanges } from "@/lib/parts/apply";
import type { PartChanges } from "@/lib/parts/changes";
import { applyUndoIn, planUndo, restorable as restoreValue } from "@/lib/parts/undo";
import { getObject, storageConfigured } from "@/lib/storage/r2";
import { currentVisit } from "@/lib/visits";
import { itemFieldLabel, itemValueText, locationNames, revertInventoryBatch } from "./inventory";
import { listCategories } from "@/lib/data/categories";
import { listRawStock } from "@/lib/data/materials";
import { categoryOf, getCategory } from "@/lib/inventory/categories";
import { PRINT_MATERIALS } from "@/config/autoSetup";
import { sizeOf, suggestSetup, wallThickness } from "./rules";
import { isDescriptiveName, looksLikeProduct, matchByName, nameMatchSetup, productSetup, type NameMatchItem, type NameMatchPart } from "./nameMatch";
import { analyzeShape } from "./shape";
import { keepFilled } from "./fill";

const { parts, systems, partReviews, partHistory, members, aiLogs } = schema;

type Part = typeof parts.$inferSelect;
export type ReviewSource = "rule" | "ai";
export type Review = typeof partReviews.$inferSelect;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------- part sizes ----------

// Parts with finer meshes skip the wall check, to keep To Review quick.
const MAX_WALL_TRIANGLES = 20_000;
// ...and the shape reading (hex, tube, plate, ...), which is quicker.
const MAX_SHAPE_TRIANGLES = 400_000;
// Bumped when measuring learns something new, so parts measured before are measured again.
// 3: the stock shape (shape.ts). 4: counterbores and steps make a plate pocketed. 5: plates are
// read before tubes, gears aren't turned spacers. 6: a round part's bore shape (hex-bore spacers).
const SIZED_VERSION = 6;

// Measures parts from the robot's built 3D model (R2 files only, no Onshape calls) and stores
// the size in parts.geometry. A part is measured again only when its Part Studio file changed.
// Returns the parts with their geometry up to date.
export async function measureParts<P extends Part>(robotId: string, rows: P[]): Promise<P[]> {
  if (!storageConfigured() || !rows.length) return rows;
  const studios = await builtStudios(robotId);
  const todo = new Map<string, P[]>(); // studio file → parts in it
  for (const p of rows) {
    if (!p.sourceDid || !p.sourceEid || !p.onshapePartId) continue;
    const file = studios.get(partKey(p.sourceDid, p.sourceEid, p.onshapePartId));
    if (!file || (p.geometry?.sizedFrom === file && p.geometry.sizedV === SIZED_VERSION)) continue;
    todo.set(file, [...(todo.get(file) ?? []), p]);
  }
  if (!todo.size) return rows;

  const sized = new Map<string, Part["geometry"]>();
  const queue = [...todo.entries()].slice(0, 40);
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [file, waiting] = job;
      const res = await getObject(file);
      if (!res) continue;
      const bytes = gunzipSync(new Uint8Array(await res.arrayBuffer()));
      const meshes = new Map(decodeMeshes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).map((m) => [m.partId, m]));
      for (const p of waiting) {
        const mesh = meshes.get(p.onshapePartId!);
        const bbox = mesh && sizeOf(mesh.positions);
        if (!bbox) continue;
        // Only a part that isn't flat needs the slower wall check (bent sheet).
        const flat = bbox[0] <= bbox[1] * 0.25;
        const wallMm = !flat && mesh.indices.length <= MAX_WALL_TRIANGLES * 3 ? wallThickness(mesh.positions, mesh.indices) : undefined;
        const shape = mesh.indices.length <= MAX_SHAPE_TRIANGLES * 3 ? analyzeShape(mesh.positions, mesh.indices) : undefined;
        const geometry = { ...(p.geometry ?? {}), bbox, minDim: bbox[0], sizedFrom: file, sizedV: SIZED_VERSION };
        if (wallMm === undefined) delete geometry.wallMm;
        else geometry.wallMm = wallMm;
        if (shape === undefined) delete geometry.shape;
        else geometry.shape = shape;
        sized.set(p.id, geometry);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (!sized.size) return rows;

  const values = [...sized].map(([id, g]) => sql`(${id}::uuid, ${JSON.stringify({ bbox: g!.bbox, minDim: g!.minDim, sizedFrom: g!.sizedFrom, sizedV: g!.sizedV, wallMm: g!.wallMm ?? null, shape: g!.shape ?? null })}::jsonb)`);
  await db.execute(
    sql`update parts set geometry = jsonb_strip_nulls(coalesce(parts.geometry, '{}'::jsonb) || v.g) from (values ${sql.join(values, sql`, `)}) as v(id, g) where parts.id = v.id`,
  );
  return rows.map((p) => (sized.has(p.id) ? { ...p, geometry: sized.get(p.id)! } : p));
}

// ---------- suggestions ----------

// The fields a suggestion may set.
// A second process is recorded as the part's added processes (Harel, 2026-11-20).
export const SETUP_FIELDS = ["classification", "material", "process1", "addedProcesses"] as const;
// Everything an AI may configure on a part that waits in To Review (Reject puts these back).
export const REVIEW_FIELDS = [
  ...SETUP_FIELDS,
  "displayName",
  "description",
  "cotsLinks",
  "unitPrice",
  "cotsCategory",
  "priority",
  "deadline",
  "designerName",
  "note",
  "inventoryItemId",
] as const;

// Applies suggested setups as one batch, and puts each changed part in To Review. A part that
// is already waiting keeps its original "before" values, so Reject still restores them.
export async function applySuggestions(
  edits: { id: string; changes: PartChanges; reason: string | null }[],
  ctx: { memberId: string | null; source: ReviewSource; via: "ui" | "mcp"; aiName?: string },
) {
  const reasons = new Map(edits.map((e) => [e.id, e.reason]));
  const batchId = randomUUID();
  return applyEachPartChanges(
    edits.map((e) => ({ id: e.id, changes: e.changes })),
    {
      memberId: ctx.memberId,
      via: ctx.via,
      batchId,
      adjust: keepFilled,
      afterEach: async (tx, row, plan) => {
        const [existing] = await tx.select().from(partReviews).where(eq(partReviews.partId, row.id)).for("update");
        const changes = { ...(existing?.changes ?? {}) };
        for (const h of plan.history) {
          if (!(REVIEW_FIELDS as readonly string[]).includes(h.field)) continue;
          const from = h.field in changes ? changes[h.field].from : h.oldValue;
          if (same(from, h.newValue)) delete changes[h.field];
          else changes[h.field] = { from, to: h.newValue };
        }
        const added = (plan.set.overriddenFields ?? []).filter((f) => !row.overriddenFields.includes(f));
        // A site rule (auto-link) adding to a part an AI just changed keeps the AI's run and name.
        const keep = existing && existing.source === "ai" && ctx.source === "rule";
        const reason = reasons.get(row.id) ?? null;
        const values = {
          source: keep ? existing.source : ctx.source,
          reason: keep ? [existing.reason, reason].filter(Boolean).join(" · ") || null : reason,
          changes,
          addedOverrides: [...new Set([...(existing?.addedOverrides ?? []), ...added])],
          memberId: keep ? existing.memberId : ctx.memberId,
          batchId: keep ? existing.batchId : batchId,
          aiName: keep ? existing.aiName : (ctx.aiName ?? null),
          createdAt: new Date(),
        };
        // A review holding a link that waits for Approve stays.
        if (!Object.keys(changes).length && !Object.keys(existing?.pending ?? {}).length) await tx.delete(partReviews).where(eq(partReviews.partId, row.id));
        else await tx.insert(partReviews).values({ partId: row.id, ...values }).onConflictDoUpdate({ target: partReviews.partId, set: values });
      },
    },
  );
}

// A robot's live CAD parts that are missing a material or every process and aren't waiting in
// To Review, measured from the 3D model. `unlinked` adds parts not marked COTS that have no
// inventory item yet (a material Onshape filled in, "Aluminum - 6061", isn't an item), so Suggest
// setup can link them to their exact Raw Stock item.
export async function partsToSetUp(robotId: string, systemId?: string, opts: { unlinked?: boolean } = {}) {
  const rows = await db
    .select({ part: parts, systemName: systems.name })
    .from(parts)
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .leftJoin(partReviews, eq(partReviews.partId, parts.id))
    .where(
      and(
        eq(systems.robotId, robotId),
        systemId ? eq(parts.systemId, systemId) : undefined,
        isNull(parts.removedFromCadAt),
        isNull(partReviews.partId),
        eq(parts.isManual, false),
        sql`${parts.classification} <> 'external'`,
        opts.unlinked
          ? sql`(${parts.material} is null or (${parts.process1} is null and ${parts.addedProcesses} = '[]'::jsonb) or (${parts.inventoryItemId} is null and ${parts.classification} <> 'cots'))`
          : sql`(${parts.material} is null or (${parts.process1} is null and ${parts.addedProcesses} = '[]'::jsonb))`,
      ),
    );
  const measured = await measureParts(robotId, rows.map((r) => ({ ...r.part, systemName: r.systemName })));
  const [stock, byName] = await Promise.all([listRawStock(), nameMatcher()]);
  const named = byName(measured.filter((p) => !p.inventoryItemId));
  return measured.map((p) => ({ part: p, guess: guessSetup(p, stock, named) }));
}

// Suggest's search by name (nameMatch.ts): every inventory item, and the links someone rejected,
// read once; the returned function finds descriptively named parts' items.
async function nameMatcher() {
  const [items, rejected, cats] = await Promise.all([db.select().from(schema.inventoryItems), db.select().from(schema.inventoryLinkRejections), listCategories()]);
  const list: NameMatchItem[] = items.map((i) => {
    const categoryId = categoryOf(i, cats);
    const cat = getCategory(cats, categoryId);
    return {
      id: i.id,
      name: i.name,
      aliases: i.aliases,
      category: cat,
      specs: i.specs,
      urls: [],
      onshapeKey: null,
      docKeys: [],
      thumbHashes: [],
      group: cat?.group ?? null,
      categoryId: cat ? categoryId : null,
      cotsLinks: i.cotsLinks,
      price: i.price,
    };
  });
  const no = new Set(rejected.map((r) => `${r.partId}:${r.itemId}`));
  return (ps: NameMatchPart[]) => (ps.length && list.length ? matchByName(ps, list, (p, i) => no.has(`${p}:${i}`)) : new Map<string, never>());
}

// A part's suggested setup: an inventory item its descriptive name matches (outside Raw Stock:
// it's COTS) comes first; then a name that says it's bought ("18t Aluminum Pulley") keeps it COTS
// without an item, unless it's printed; otherwise the rules' guess from its material and shape.
function guessSetup(
  p: Part,
  stock: Awaited<ReturnType<typeof listRawStock>>,
  named: ReturnType<Awaited<ReturnType<typeof nameMatcher>>>,
): { changes: PartChanges; reason: string } | null {
  const hit = named.get(p.id);
  const byItem = hit && nameMatchSetup(p, hit);
  if (byItem) return byItem;
  if (!p.inventoryItemId && !isPrinted(p) && looksLikeProduct(p.displayName ?? p.onshapeName)) return productSetup(p);
  return suggestSetup(p, stock);
}

// Onshape's material, or the part's, is a 3D printing material.
const isPrinted = (p: Pick<Part, "material" | "geometry">) => PRINT_MATERIALS.some((m) => m.match.test(`${p.geometry?.onshapeMaterial ?? ""} ${p.material ?? ""}`));

// A part the rules have nothing to read from: no Onshape material, no 3D measurement and a name
// that's only a number ("Part 12"). Its robot's 3D model has to be built first.
const blind = (p: Part) => !p.geometry?.onshapeMaterial && !p.geometry?.bbox && !isDescriptiveName(p.displayName ?? p.onshapeName);

// Auto-link for these parts (imported when used: autolink.ts imports this file).
async function linkParts(partIds: string[], memberId: string) {
  if (!partIds.length) return 0;
  const { autoLink } = await import("@/lib/inventory/autolink");
  return autoLink({ partIds }, { memberId, via: "ui" });
}

// Suggest setup on To Review: the rules' guess for every part that needs one, then auto-link's
// inventory item for the ones still without (COTS parts; in-house parts get their Raw Stock item
// with the material).
export async function suggestRobotSetups(robotId: string, memberId: string, systemId?: string) {
  const todo = await partsToSetUp(robotId, systemId, { unlinked: true });
  const edits = todo.flatMap((t) => (t.guess ? [{ id: t.part.id, ...t.guess }] : []));
  const { changed, batchId } = await applySuggestions(edits, { memberId, source: "rule", via: "ui" });
  if (changed) {
    await logAiAction({ source: "rule", tool: "Suggest setup", memberId, batchId, parts: changed, summary: `Set up ${changed} of ${todo.length} parts that had no material, processes or inventory item` });
  }
  const linked = await linkParts(todo.map((t) => t.part.id), memberId);
  return { checked: todo.length, suggested: changed, linked };
}

// The part window's Suggest: a fresh setup for that one part, as the system page's Suggest mode
// works it out (a process set before, by hand or by an older Suggest, is suggested again from the
// shape: Harel, 2026-11-13, a pocketed plate kept the Laser an old Suggest gave it), and
// auto-link's inventory item. Both wait in To Review, where the window's Approve and Reject
// settle them.
export async function suggestOnePart(partId: string, memberId: string) {
  const [row] = await db
    .select({ part: parts, robotId: systems.robotId, systemName: systems.name })
    .from(parts)
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .where(eq(parts.id, partId));
  if (!row) return null;
  const [measured] = row.part.isManual ? [row.part] : await measureParts(row.robotId, [{ ...row.part, systemName: row.systemName }]);
  const [stock, byName] = await Promise.all([listRawStock(), nameMatcher()]);
  const edit = row.part.classification === "external" ? null : freshEdit(measured, stock, byName([measured]), new Set(stock.map((i) => i.name)));
  let setUp = 0;
  if (edit) {
    const { changed, batchId } = await applySuggestions([edit], { memberId, source: "rule", via: "ui" });
    setUp = changed;
    if (changed) await logAiAction({ source: "rule", tool: "Suggest setup", memberId, batchId, parts: 1, summary: `Set up "${row.part.displayName ?? row.part.onshapeName ?? "a part"}" from the part window` });
  }
  const linked = await linkParts([partId], memberId);
  return { setUp, linked, reason: edit?.reason ?? null };
}

// The system page's Suggest mode: fresh setups for the picked parts, set up or not (freshEdit).
// Only fields that change are written, and every one waits in To Review with its "from → to",
// like Suggest setup. Then auto-link for the ones without an item. `blind`: parts with nothing
// to read (no Onshape material, no 3D measurement, a numbered name).
export async function suggestPickedParts(partIds: string[], memberId: string) {
  if (!partIds.length) return { checked: 0, suggested: 0, linked: 0, blind: 0 };
  const rows = await db
    .select({ part: parts, robotId: systems.robotId, systemName: systems.name })
    .from(parts)
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .where(and(inArray(parts.id, partIds), isNull(parts.removedFromCadAt), sql`${parts.classification} <> 'external'`));
  const byRobot = new Map<string, (Part & { systemName: string })[]>();
  for (const r of rows) byRobot.set(r.robotId, [...(byRobot.get(r.robotId) ?? []), { ...r.part, systemName: r.systemName }]);
  const measured: (Part & { systemName: string })[] = [];
  for (const [robotId, list] of byRobot) {
    measured.push(...list.filter((p) => p.isManual), ...(await measureParts(robotId, list.filter((p) => !p.isManual))));
  }
  const [stock, byName] = await Promise.all([listRawStock(), nameMatcher()]);
  const named = byName(measured);
  const stockNames = new Set(stock.map((i) => i.name));
  const edits = measured.flatMap((p) => {
    const edit = freshEdit(p, stock, named, stockNames);
    return edit ? [edit] : [];
  });
  const { changed, batchId } = await applySuggestions(edits, { memberId, source: "rule", via: "ui" });
  if (changed) {
    await logAiAction({ source: "rule", tool: "Suggest setup", memberId, batchId, parts: changed, summary: `Suggested a fresh setup for ${changed} of ${measured.length} picked parts` });
  }
  const linked = await linkParts(measured.map((p) => p.id), memberId);
  return { checked: measured.length, suggested: changed, linked, blind: measured.filter((p) => blind(p) && !edits.some((e) => e.id === p.id)).length };
}

// A fresh setup for one part, set up or not, with only the fields that change. Its material and
// item are worked out as if it had none (classification stays, so a COTS part only turns in-house
// for plates and prints; a part named like a product stays COTS); when the rules find no Raw Stock
// item, its own material still picks the processes.
function freshEdit(
  p: Part,
  stock: Awaited<ReturnType<typeof listRawStock>>,
  named: ReturnType<Awaited<ReturnType<typeof nameMatcher>>>,
  stockNames: Set<string>,
): { id: string; changes: PartChanges; reason: string } | null {
  const hit = named.get(p.id);
  const byItem = hit && nameMatchSetup(p, hit);
  if (byItem) return { id: p.id, ...byItem };
  if (!isPrinted(p) && (looksLikeProduct(p.displayName ?? p.onshapeName) || looksBought(p))) {
    const product = productSetup(p);
    return product ? { id: p.id, ...product } : null;
  }
  // Worked out as if the part had no item: an old free-text material ("6.7mm 6061-T6") stays as
  // a hint, an item's name doesn't.
  const blankProcesses = { process1: null, addedProcesses: [] };
  const material = p.material && !stockNames.has(p.material) ? p.material : null;
  const fresh = suggestSetup({ ...p, ...blankProcesses, material, inventoryItemId: null }, stock);
  const guess = fresh?.changes.material ? fresh : suggestSetup({ ...p, ...blankProcesses }, stock);
  if (!guess) return null;
  const changes = { ...guess.changes };
  // A print gets the plain material and no filament item (Harel, 2026-11-01).
  if (p.inventoryItemId && changes.material && !("inventoryItemId" in changes) && PRINT_MATERIALS.some((m) => m.material === changes.material)) changes.inventoryItemId = null;
  // Processes are worked out fresh too: the setups on the robots so far are tests, not the
  // team's choices (Harel, 2026-11-06).
  for (const f of Object.keys(changes) as (keyof typeof changes)[]) if (same(changes[f], f === "process2" ? (p.addedProcesses[0]?.machine ?? null) : p[f as keyof Part])) delete changes[f];
  return Object.keys(changes).length ? { id: p.id, changes, reason: guess.reason } : null;
}

// A COTS part already linked to its item: the shape rules don't turn it in-house.
const looksBought = (p: Part) => p.classification === "cots" && !!p.inventoryItemId;

// What a part has waiting in To Review, for its window's Approve and Reject.
export async function partReview(partId: string) {
  const [r] = await db.select().from(partReviews).where(eq(partReviews.partId, partId));
  if (!r) return null;
  const itemIds = [r.pending.inventoryItemId, r.changes.inventoryItemId?.to, r.changes.inventoryItemId?.from].filter((v): v is string => typeof v === "string");
  const items = itemIds.length
    ? await db.select({ id: schema.inventoryItems.id, name: schema.inventoryItems.name }).from(schema.inventoryItems).where(inArray(schema.inventoryItems.id, itemIds))
    : [];
  const pendingItem = typeof r.pending.inventoryItemId === "string" ? (items.find((i) => i.id === r.pending.inventoryItemId)?.name ?? "an inventory item") : null;
  return {
    source: r.source,
    aiName: r.aiName,
    reason: r.reason,
    fields: Object.keys(r.changes),
    // Each changed field's old and new value, and the names of the inventory items in them, so the
    // part window can show "old → new" on every row the suggestion touched.
    changes: r.changes as Record<string, { from: unknown; to: unknown }>,
    itemNames: Object.fromEntries(items.map((i) => [i.id, i.name])) as Record<string, string>,
    pendingItem,
  };
}

// ---------- review ----------

export type RobotReview = Review & { memberName: string | null };

export async function listRobotReviews(robotId: string): Promise<RobotReview[]> {
  const rows = await db
    .select({ review: partReviews, memberName: members.name })
    .from(partReviews)
    .innerJoin(parts, eq(parts.id, partReviews.partId))
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .leftJoin(members, eq(members.id, partReviews.memberId))
    .where(and(eq(systems.robotId, robotId), isNull(parts.removedFromCadAt)));
  return rows.map((r) => ({ ...r.review, memberName: r.memberName }));
}

// ---------- AI logs ----------

export async function logAiAction(entry: {
  source: ReviewSource;
  tool: string;
  memberId: string | null;
  batchId?: string | null;
  aiName?: string | null;
  summary: string;
  parts?: number | null;
}) {
  await db.insert(aiLogs).values({
    source: entry.source,
    tool: entry.tool,
    memberId: entry.memberId,
    batchId: entry.batchId ?? null,
    aiName: entry.aiName ?? null,
    summary: entry.summary.slice(0, 500),
    parts: entry.parts ?? null,
  });
}

export type AiLogChange = { partId: string; part: string; system: string; robot: string; field: string; from: unknown; to: unknown };
// A change the batch made to an inventory item: an edited field, "created", or "stock".
export type AiLogItemChange = { itemId: string; item: string; category: string; field: string; label: string; from: string | null; to: string | null };
export type AiLog = {
  id: string;
  batchId: string | null;
  revertedAt: string | null;
  source: ReviewSource | "manual";
  tool: string;
  aiName: string | null;
  memberName: string | null;
  summary: string;
  parts: number | null;
  at: string;
  changes: AiLogChange[]; // up to CHANGES_PER_LOG, in part order
  changeCount: number;
  waiting: number; // parts and inventory items of the batch still in To Review
  itemChanges: AiLogItemChange[]; // up to CHANGES_PER_LOG
  itemChangeCount: number;
};

const CHANGES_PER_LOG = 60;

// The most recent AI actions with what they changed, for the AI logs page.
export async function listAiLogs(limit = 100): Promise<AiLog[]> {
  const logs = await db
    .select({ log: aiLogs, memberName: members.name })
    .from(aiLogs)
    .leftJoin(members, eq(members.id, aiLogs.memberId))
    .orderBy(desc(aiLogs.createdAt))
    .limit(limit);
  const batchIds = [...new Set(logs.flatMap((l) => (l.log.batchId ? [l.log.batchId] : [])))];
  const history = batchIds.length
    ? await db
        .select({
          batchId: partHistory.batchId,
          partId: partHistory.partId,
          field: partHistory.field,
          from: partHistory.oldValue,
          to: partHistory.newValue,
          name: parts.displayName,
          onshapeName: parts.onshapeName,
          partNumber: parts.partNumber,
          system: systems.name,
          robot: schema.robots.name,
        })
        .from(partHistory)
        .innerJoin(parts, eq(parts.id, partHistory.partId))
        .innerJoin(systems, eq(systems.id, parts.systemId))
        .innerJoin(schema.robots, eq(schema.robots.id, systems.robotId))
        // overriddenFields is recorded with the edit that set it (undo needs it), not shown as a change.
        .where(and(inArray(partHistory.batchId, batchIds), ne(partHistory.field, "overriddenFields")))
        .orderBy(asc(partHistory.at))
    : [];
  const { inventoryItemHistory, inventoryMoves, inventoryItems, inventoryReviews } = schema;
  const [waiting, waitingItems, itemHistory, moves, cats, locations] = batchIds.length
    ? await Promise.all([
        db
          .select({ batchId: partReviews.batchId, n: sql<number>`count(*)::int` })
          .from(partReviews)
          .where(inArray(partReviews.batchId, batchIds))
          .groupBy(partReviews.batchId),
        db
          .select({ batchId: inventoryReviews.batchId, n: sql<number>`count(*)::int` })
          .from(inventoryReviews)
          .where(inArray(inventoryReviews.batchId, batchIds))
          .groupBy(inventoryReviews.batchId),
        db
          .select({ h: inventoryItemHistory, name: inventoryItems.name, category: inventoryItems.category })
          .from(inventoryItemHistory)
          .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryItemHistory.itemId))
          .where(inArray(inventoryItemHistory.batchId, batchIds))
          .orderBy(asc(inventoryItemHistory.at)),
        db
          .select({ m: inventoryMoves, name: inventoryItems.name, category: inventoryItems.category })
          .from(inventoryMoves)
          .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryMoves.itemId))
          .where(inArray(inventoryMoves.batchId, batchIds))
          .orderBy(asc(inventoryMoves.at)),
        listCategories(),
        locationNames(),
      ])
    : [[], [], [], [], [], new Map<string, string>()];
  const catLabel = (id: string | null) => getCategory(cats, id)?.label ?? "No category";
  const itemChanges = new Map<string, AiLogItemChange[]>();
  const addItemChange = (batchId: string | null, c: AiLogItemChange) => {
    if (batchId) itemChanges.set(batchId, [...(itemChanges.get(batchId) ?? []), c]);
  };
  for (const { h, name, category } of itemHistory) {
    const ctx = { cats, locations, category };
    addItemChange(h.batchId, {
      itemId: h.itemId,
      item: name,
      category: catLabel(category),
      field: h.field,
      label: h.field === "created" ? "Added" : itemFieldLabel(h.field),
      from: h.field === "created" ? null : itemValueText(h.field, h.oldValue, ctx),
      to: h.field === "created" ? String(h.newValue ?? name) : itemValueText(h.field, h.newValue, ctx),
    });
  }
  for (const { m, name, category } of moves) {
    addItemChange(m.batchId, { itemId: m.itemId, item: name, category: catLabel(category), field: "stock", label: "Stock", from: null, to: `${m.delta > 0 ? "+" : ""}${m.delta}` });
  }
  return logs.map(({ log, memberName }) => {
    const mine = history.filter((h) => h.batchId === log.batchId);
    const items = (log.batchId && itemChanges.get(log.batchId)) || [];
    return {
      id: log.id,
      batchId: log.batchId,
      revertedAt: log.revertedAt?.toISOString() ?? null,
      itemChanges: items.slice(0, CHANGES_PER_LOG),
      itemChangeCount: items.length,
      source: log.source,
      tool: log.tool,
      aiName: log.aiName,
      memberName,
      summary: log.summary,
      parts: log.parts,
      at: log.createdAt.toISOString(),
      changeCount: mine.length,
      waiting: (waiting.find((w) => w.batchId === log.batchId)?.n ?? 0) + (waitingItems.find((w) => w.batchId === log.batchId)?.n ?? 0),
      changes: mine.slice(0, CHANGES_PER_LOG).map((h) => ({
        partId: h.partId,
        part: [h.partNumber, h.name ?? h.onshapeName ?? "Unnamed part"].filter(Boolean).join(" "),
        system: h.system,
        robot: h.robot,
        field: h.field,
        from: h.from,
        to: h.to,
      })),
    };
  });
}

// The card's X: off To Review, nothing applied or put back (a waiting link is dropped).
export async function dismissReviews(partIds: string[]) {
  if (!partIds.length) return 0;
  const rows = await db.delete(partReviews).where(inArray(partReviews.partId, partIds)).returning({ id: partReviews.partId });
  return rows.length;
}

// Approve keeps the suggestion, makes the changes that were waiting (an inventory link), and
// takes the part off To Review.
// One transaction: if the waiting change can't be made, the review stays (it used to be gone
// while the link was never made).
export async function approveReviews(partIds: string[], memberId: string | null = null) {
  if (!partIds.length) return 0;
  return db.transaction(async (tx) => {
    const rows = await tx.delete(partReviews).where(inArray(partReviews.partId, partIds)).returning({ id: partReviews.partId, pending: partReviews.pending });
    // A suggested link to an item deleted since can't be made; the rest of the review still is.
    const live = await liveItems(rows.flatMap((r) => [r.pending.inventoryItemId]), tx);
    const waiting = rows.flatMap((r) => {
      const changes = { ...r.pending } as PartChanges;
      if (typeof changes.inventoryItemId === "string" && !live.has(changes.inventoryItemId)) delete changes.inventoryItemId;
      return Object.keys(changes).length ? [{ id: r.id, changes }] : [];
    });
    if (waiting.length) await applyEachPartChanges(waiting, { memberId, via: "ui", tx });
    return rows.length;
  });
}

// The card's Link tag settles just the suggested link, leaving the rest of a part's review in To
// Review. Link (`accept`) only takes it off the review: the card links the part through its own
// save. ✕ drops it and remembers the pair, as To Review's Reject does, so it isn't suggested
// again (also for the card's own guess, which has no review).
export async function settleSuggestedLink(partIds: string[], itemId: string, accept: boolean, memberId: string) {
  if (!partIds.length) return;
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(partReviews).where(inArray(partReviews.partId, partIds)).for("update");
    for (const r of rows) {
      if (r.pending.inventoryItemId !== itemId) continue;
      const pending = { ...r.pending };
      delete pending.inventoryItemId;
      if (!Object.keys(pending).length && !Object.keys(r.changes).length) await tx.delete(partReviews).where(eq(partReviews.partId, r.partId));
      else await tx.update(partReviews).set({ pending }).where(eq(partReviews.partId, r.partId));
    }
    if (!accept && (await liveItems([itemId], tx)).has(itemId))
      await tx.insert(schema.inventoryLinkRejections).values(partIds.map((partId) => ({ partId, itemId, memberId }))).onConflictDoNothing();
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Which of these inventory item ids still exist.
async function liveItems(ids: unknown[], exec: Tx | typeof db = db) {
  const wanted = [...new Set(ids.filter((v): v is string => typeof v === "string"))];
  if (!wanted.length) return new Set<string>();
  const rows = await exec.select({ id: schema.inventoryItems.id }).from(schema.inventoryItems).where(inArray(schema.inventoryItems.id, wanted));
  return new Set(rows.map((r) => r.id));
}

// The value Reject writes back: never null into a column that can't hold it, never a link to an
// item deleted since.
function restorable(field: string, from: unknown, live: Set<string>) {
  if (field === "inventoryItemId") return typeof from === "string" && live.has(from) ? from : null;
  return restoreValue(field, from);
}

// Reject puts every suggested field back, except one someone edited since, and takes the part
// off To Review. The revert is recorded in part_history like any edit.
export async function rejectReviews(partIds: string[], memberId: string) {
  if (!partIds.length) return { rejected: 0, keptEdits: 0 };
  const batchId = randomUUID();
  const visit = await currentVisit();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ review: partReviews, part: parts })
      .from(partReviews)
      .innerJoin(parts, eq(parts.id, partReviews.partId))
      .where(inArray(partReviews.partId, partIds))
      .for("update");
    let keptEdits = 0;
    const history: (typeof partHistory.$inferInsert)[] = [];
    // A rejected inventory link isn't suggested again. Links to items deleted since are skipped
    // (they broke the whole Reject on the rejections' foreign key), and each pair goes in once.
    const live = await liveItems(
      rows.flatMap(({ review }) => [review.pending.inventoryItemId, review.changes.inventoryItemId?.to, review.changes.inventoryItemId?.from]),
      tx,
    );
    const noLinks = new Map<string, { partId: string; itemId: string; memberId: string }>();
    for (const { review } of rows) {
      for (const itemId of [review.pending.inventoryItemId, review.changes.inventoryItemId?.to]) {
        if (typeof itemId === "string" && live.has(itemId)) noLinks.set(`${review.partId}:${itemId}`, { partId: review.partId, itemId, memberId });
      }
    }
    if (noLinks.size) await tx.insert(schema.inventoryLinkRejections).values([...noLinks.values()]).onConflictDoNothing();
    for (const { review, part } of rows) {
      const current = part as unknown as Record<string, unknown>;
      const reverted = Object.entries(review.changes).filter(([field, c]) => {
        const back = same(current[field], c.to);
        if (!back) keptEdits++;
        return back;
      });
      if (reverted.length) {
        const fields = new Set(reverted.map(([f]) => f));
        await tx
          .update(parts)
          .set({
            ...Object.fromEntries(reverted.map(([f, c]) => [f, restorable(f, c.from, live)])),
            overriddenFields: part.overriddenFields.filter((f) => !(fields.has(f) && review.addedOverrides.includes(f))),
            lastModifiedAt: new Date(),
            lastModifiedBy: memberId,
          })
          .where(eq(parts.id, part.id));
        history.push(...reverted.map(([field, c]) => ({ partId: part.id, field, oldValue: c.to, newValue: restorable(field, c.from, live), memberId, via: "ui" as const, batchId, visitId: visit?.id, page: visit?.page })));
      }
    }
    // One insert and one delete for the whole group instead of a pair per part.
    if (history.length) await tx.insert(partHistory).values(history);
    if (rows.length) await tx.delete(partReviews).where(inArray(partReviews.partId, rows.map((r) => r.part.id)));
    return { rejected: rows.length, keptEdits };
  });
}

// Revert change on the AI logs page (and undo_batch): everything one AI run changed goes back.
// Part fields and item fields edited again since are kept; stock moves are reversed; items and
// categories the run added are removed; its To Review entries go.
// A run reverts once: its log is locked and marked in the same transaction as every change, so
// two managers (or a retried undo_batch) can't reverse its stock twice, and a failure leaves
// nothing half reverted.
export async function revertAiBatch(batchId: string, memberId: string, via: "ui" | "mcp") {
  const plan = await planUndo(batchId);
  const reverts = plan?.reverts ?? [];
  const undoBatch = randomUUID();
  const ctx = { memberId, via, batchId: undoBatch } as const;
  const result = await db.transaction(async (tx) => {
    const logs = await tx.select({ revertedAt: aiLogs.revertedAt }).from(aiLogs).where(eq(aiLogs.batchId, batchId)).for("update");
    if (logs.some((l) => l.revertedAt)) return null;
    const { kept: late } = await applyUndoIn(tx, reverts, { memberId, via, batchId: undoBatch });
    // Deleting the items it created takes their stock moves with them, so they're not reversed twice.
    const inventory = await revertInventoryBatch(tx, batchId, ctx);
    const stock = await undoMoves(tx, batchId, ctx);
    // Its parts in To Review keep only what is still changed (an edit made since, or another run's).
    const reviews = await tx
      .select({ review: partReviews, part: parts })
      .from(partReviews)
      .innerJoin(parts, eq(parts.id, partReviews.partId))
      .where(eq(partReviews.batchId, batchId))
      .for("update");
    for (const { review, part } of reviews) {
      const current = part as unknown as Record<string, unknown>;
      const changes = Object.fromEntries(Object.entries(review.changes).filter(([f, c]) => !same(current[f], c.from)));
      if (!Object.keys(changes).length) await tx.delete(partReviews).where(eq(partReviews.partId, part.id));
      else await tx.update(partReviews).set({ changes, pending: {} }).where(eq(partReviews.partId, part.id));
    }
    await tx.update(aiLogs).set({ revertedAt: new Date() }).where(eq(aiLogs.batchId, batchId));
    return { inventory, stock, late };
  });
  if (!result) return { batchId: undoBatch, reverted: 0, message: "This run was already reverted." };
  const { inventory, stock, late } = result;
  const partFields = reverts.length - late;
  const kept = (plan?.skipped.length ?? 0) + late + inventory.kept;
  const done = [
    partFields && `${partFields} part ${partFields === 1 ? "field" : "fields"}`,
    inventory.edited && `${inventory.edited} item ${inventory.edited === 1 ? "field" : "fields"}`,
    inventory.created && `removed ${inventory.created} added ${inventory.created === 1 ? "item" : "items"}`,
    inventory.categories && `removed ${inventory.categories} ${inventory.categories === 1 ? "category" : "categories"}`,
    stock && `${stock} stock ${stock === 1 ? "change" : "changes"}`,
  ].filter(Boolean);
  return {
    batchId: undoBatch,
    reverted: partFields + inventory.edited + inventory.created + inventory.categories + stock,
    message:
      (done.length ? `Reverted ${done.join(", ")}.` : "Nothing left to revert.") +
      (kept ? ` ${kept} ${kept === 1 ? "field was" : "fields were"} edited again since and kept.` : ""),
  };
}
