import "server-only";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { partKey } from "@/lib/model/assembly";
import { builtStudios } from "@/lib/model/build";
import { decodeMeshes } from "@/lib/model/mesh";
import { applyEachPartChanges } from "@/lib/parts/apply";
import type { PartChanges } from "@/lib/parts/changes";
import { getObject, storageConfigured } from "@/lib/storage/r2";
import { currentVisit } from "@/lib/visits";
import { sizeOf, suggestSetup, wallThickness, type Learned } from "./rules";

const { parts, systems, partReviews, partHistory, members, aiLogs } = schema;

type Part = typeof parts.$inferSelect;
export type ReviewSource = "rule" | "ai";
export type Review = typeof partReviews.$inferSelect;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------- part sizes ----------

// Parts with finer meshes skip the wall check, to keep To Review quick.
const MAX_WALL_TRIANGLES = 20_000;
// Bumped when measuring learns something new, so parts measured before are measured again.
const SIZED_VERSION = 2;

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
        const geometry = { ...(p.geometry ?? {}), bbox, minDim: bbox[0], sizedFrom: file, sizedV: SIZED_VERSION };
        if (wallMm === undefined) delete geometry.wallMm;
        else geometry.wallMm = wallMm;
        sized.set(p.id, geometry);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (!sized.size) return rows;

  const values = [...sized].map(([id, g]) => sql`(${id}::uuid, ${JSON.stringify({ bbox: g!.bbox, minDim: g!.minDim, sizedFrom: g!.sizedFrom, sizedV: g!.sizedV, wallMm: g!.wallMm ?? null })}::jsonb)`);
  await db.execute(
    sql`update parts set geometry = jsonb_strip_nulls(coalesce(parts.geometry, '{}'::jsonb) || v.g) from (values ${sql.join(values, sql`, `)}) as v(id, g) where parts.id = v.id`,
  );
  return rows.map((p) => (sized.has(p.id) ? { ...p, geometry: sized.get(p.id)! } : p));
}

// ---------- suggestions ----------

// The fields a suggestion may set.
export const SETUP_FIELDS = ["classification", "material", "preProcess", "process1", "process2"] as const;
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
        if (!Object.keys(changes).length) await tx.delete(partReviews).where(eq(partReviews.partId, row.id));
        else await tx.insert(partReviews).values({ partId: row.id, ...values }).onConflictDoUpdate({ target: partReviews.partId, set: values });
      },
    },
  );
}

// The most common process set per material on the team's parts that a person set up (parts
// still waiting in To Review don't count).
async function learnedProcesses(): Promise<Learned> {
  const rows = await db
    .select({ material: parts.material, preProcess: parts.preProcess, process1: parts.process1, process2: parts.process2, n: sql<number>`count(*)::int` })
    .from(parts)
    .leftJoin(partReviews, eq(partReviews.partId, parts.id))
    .where(and(isNotNull(parts.material), isNotNull(parts.process1), isNull(partReviews.partId)))
    .groupBy(parts.material, parts.preProcess, parts.process1, parts.process2);
  const learned: Learned = new Map();
  for (const r of rows) {
    const best = learned.get(r.material!);
    if (!best || r.n > best.count) {
      learned.set(r.material!, { preProcess: r.preProcess ?? undefined, process1: r.process1 ?? undefined, process2: r.process2 ?? undefined, count: r.n });
    }
  }
  return learned;
}

// A robot's live CAD parts that are missing a material or every process and aren't waiting in
// To Review, measured from the 3D model.
export async function partsToSetUp(robotId: string, systemId?: string) {
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
        sql`(${parts.material} is null or coalesce(${parts.preProcess}, ${parts.process1}, ${parts.process2}) is null)`,
      ),
    );
  const measured = await measureParts(robotId, rows.map((r) => ({ ...r.part, systemName: r.systemName })));
  const learned = await learnedProcesses();
  return measured.map((p) => ({ part: p, guess: suggestSetup(p, learned) }));
}

// Suggest setup on To Review: the rules' guess for every part that needs one.
export async function suggestRobotSetups(robotId: string, memberId: string) {
  const todo = await partsToSetUp(robotId);
  const edits = todo.flatMap((t) => (t.guess ? [{ id: t.part.id, ...t.guess }] : []));
  const { changed, batchId } = await applySuggestions(edits, { memberId, source: "rule", via: "ui" });
  if (changed) {
    await logAiAction({ source: "rule", tool: "Suggest setup", memberId, batchId, parts: changed, summary: `Set up ${changed} of ${todo.length} parts that had no material or processes` });
  }
  return { checked: todo.length, suggested: changed };
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
export type AiLog = {
  id: string;
  source: ReviewSource | "manual";
  tool: string;
  aiName: string | null;
  memberName: string | null;
  summary: string;
  parts: number | null;
  at: string;
  changes: AiLogChange[]; // up to CHANGES_PER_LOG, in part order
  changeCount: number;
  waiting: number; // parts of the batch still in To Review
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
        .where(inArray(partHistory.batchId, batchIds))
        .orderBy(asc(partHistory.at))
    : [];
  const waiting = batchIds.length
    ? await db
        .select({ batchId: partReviews.batchId, n: sql<number>`count(*)::int` })
        .from(partReviews)
        .where(inArray(partReviews.batchId, batchIds))
        .groupBy(partReviews.batchId)
    : [];
  return logs.map(({ log, memberName }) => {
    const mine = history.filter((h) => h.batchId === log.batchId);
    return {
      id: log.id,
      source: log.source,
      tool: log.tool,
      aiName: log.aiName,
      memberName,
      summary: log.summary,
      parts: log.parts,
      at: log.createdAt.toISOString(),
      changeCount: mine.length,
      waiting: waiting.find((w) => w.batchId === log.batchId)?.n ?? 0,
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

// Approve keeps the suggestion and takes the part off To Review.
export async function approveReviews(partIds: string[]) {
  if (!partIds.length) return 0;
  const rows = await db.delete(partReviews).where(inArray(partReviews.partId, partIds)).returning({ id: partReviews.partId });
  return rows.length;
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
            ...Object.fromEntries(reverted.map(([f, c]) => [f, c.from])),
            overriddenFields: part.overriddenFields.filter((f) => !(fields.has(f) && review.addedOverrides.includes(f))),
            lastModifiedAt: new Date(),
            lastModifiedBy: memberId,
          })
          .where(eq(parts.id, part.id));
        history.push(...reverted.map(([field, c]) => ({ partId: part.id, field, oldValue: c.to, newValue: c.from, memberId, via: "ui" as const, batchId, visitId: visit?.id, page: visit?.page })));
      }
    }
    // One insert and one delete for the whole group instead of a pair per part.
    if (history.length) await tx.insert(partHistory).values(history);
    if (rows.length) await tx.delete(partReviews).where(inArray(partReviews.partId, rows.map((r) => r.part.id)));
    return { rejected: rows.length, keptEdits };
  });
}
