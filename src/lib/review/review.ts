import "server-only";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { partKey } from "@/lib/model/assembly";
import { builtStudios } from "@/lib/model/build";
import { decodeMeshes } from "@/lib/model/mesh";
import { applyEachPartChanges } from "@/lib/parts/apply";
import type { PartChanges } from "@/lib/parts/changes";
import { getObject, storageConfigured } from "@/lib/storage/r2";
import { sizeOf, suggestSetup, type Learned } from "./rules";

const { parts, systems, partReviews, partHistory } = schema;

type Part = typeof parts.$inferSelect;
export type ReviewSource = "rule" | "ai";
export type Review = typeof partReviews.$inferSelect;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------- part sizes ----------

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
    if (!file || p.geometry?.sizedFrom === file) continue;
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
        if (bbox) sized.set(p.id, { ...(p.geometry ?? {}), bbox, minDim: bbox[0], sizedFrom: file });
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  if (!sized.size) return rows;

  const values = [...sized].map(([id, g]) => sql`(${id}::uuid, ${JSON.stringify({ bbox: g!.bbox, minDim: g!.minDim, sizedFrom: g!.sizedFrom })}::jsonb)`);
  await db.execute(
    sql`update parts set geometry = coalesce(parts.geometry, '{}'::jsonb) || v.g from (values ${sql.join(values, sql`, `)}) as v(id, g) where parts.id = v.id`,
  );
  return rows.map((p) => (sized.has(p.id) ? { ...p, geometry: sized.get(p.id)! } : p));
}

// ---------- suggestions ----------

// The fields a suggestion may set.
export const SETUP_FIELDS = ["classification", "material", "preProcess", "process1", "process2"] as const;

// Applies suggested setups as one batch, and puts each changed part in To Review. A part that
// is already waiting keeps its original "before" values, so Reject still restores them.
export async function applySuggestions(
  edits: { id: string; changes: Pick<PartChanges, (typeof SETUP_FIELDS)[number]>; reason: string }[],
  ctx: { memberId: string | null; source: ReviewSource; via: "ui" | "mcp" },
) {
  const reasons = new Map(edits.map((e) => [e.id, e.reason]));
  return applyEachPartChanges(
    edits.map((e) => ({ id: e.id, changes: e.changes })),
    {
      memberId: ctx.memberId,
      via: ctx.via,
      afterEach: async (tx, row, plan) => {
        const [existing] = await tx.select().from(partReviews).where(eq(partReviews.partId, row.id)).for("update");
        const changes = { ...(existing?.changes ?? {}) };
        for (const h of plan.history) {
          if (!(SETUP_FIELDS as readonly string[]).includes(h.field)) continue;
          const from = h.field in changes ? changes[h.field].from : h.oldValue;
          if (same(from, h.newValue)) delete changes[h.field];
          else changes[h.field] = { from, to: h.newValue };
        }
        const added = (plan.set.overriddenFields ?? []).filter((f) => !row.overriddenFields.includes(f));
        const values = {
          source: ctx.source,
          reason: reasons.get(row.id) ?? null,
          changes,
          addedOverrides: [...new Set([...(existing?.addedOverrides ?? []), ...added])],
          memberId: ctx.memberId,
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
  const { changed } = await applySuggestions(edits, { memberId, source: "rule", via: "ui" });
  return { checked: todo.length, suggested: changed };
}

// ---------- review ----------

export async function listRobotReviews(robotId: string): Promise<Review[]> {
  return db
    .select({ review: partReviews })
    .from(partReviews)
    .innerJoin(parts, eq(parts.id, partReviews.partId))
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .where(and(eq(systems.robotId, robotId), isNull(parts.removedFromCadAt)))
    .then((rows) => rows.map((r) => r.review));
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
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ review: partReviews, part: parts })
      .from(partReviews)
      .innerJoin(parts, eq(parts.id, partReviews.partId))
      .where(inArray(partReviews.partId, partIds))
      .for("update");
    let keptEdits = 0;
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
        await tx
          .insert(partHistory)
          .values(reverted.map(([field, c]) => ({ partId: part.id, field, oldValue: c.to, newValue: c.from, memberId, via: "ui" as const, batchId })));
      }
      await tx.delete(partReviews).where(eq(partReviews.partId, part.id));
    }
    return { rejected: rows.length, keptEdits };
  });
}
