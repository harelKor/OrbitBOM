import "server-only";
import { and, desc, eq, gte, lt, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { fieldName } from "@/lib/data/actions";
import { applyUndo, planUndo, planUndoVisit } from "@/lib/parts/undo";
import { revertSystem } from "@/lib/versions/history";
import { VersionError } from "@/lib/versions/commit";

const { partHistory, systemVersions } = schema;

export type RevertResult = {
  message: string;
  batchId: string | null;
  skipped: number;
};

type Plan = Awaited<ReturnType<typeof planUndo>>;

// What an undo did, for the toast: "Status and Material on 3 parts", and what it left alone.
function describe(plan: NonNullable<Plan>) {
  // overriddenFields goes back with the edit that set it; it isn't a field anyone typed.
  const shown = plan.reverts.filter((r) => r.field !== "overriddenFields");
  const fields = [...new Set(shown.map((r) => fieldName(r.field)))];
  const partCount = new Set(shown.map((r) => r.partId)).size;
  const what = fields.length
    ? `${fields.slice(0, 3).join(", ")}${fields.length > 3 ? "…" : ""} on ${partCount} ${partCount === 1 ? "part" : "parts"}`
    : "nothing";
  const left = plan.skipped.length
    ? ` ${plan.skipped.length} ${plan.skipped.length === 1 ? "field was" : "fields were"} changed again later and left as they are.`
    : "";
  return { what, left };
}

async function apply(plan: Plan, memberId: string, verb: string): Promise<RevertResult> {
  if (!plan || (!plan.reverts.length && !plan.skipped.length)) return { message: "Nothing to undo there.", batchId: null, skipped: 0 };
  const { what, left } = describe(plan);
  if (!plan.reverts.length)
    return {
      message: `Nothing changed: everything was edited again since.${left}`,
      batchId: null,
      skipped: plan.skipped.length,
    };
  const batchId = await applyUndo(plan.reverts, memberId, "ui", plan.batches);
  return {
    message: `${verb} ${what}.${left}`,
    batchId,
    skipped: plan.skipped.length,
  };
}

// Recent actions' Revert on a page visit: every part edit made in it goes back (plan §8). A
// field someone changed again afterwards is skipped and reported. The revert is a new change.
export async function revertVisit(visitId: string, memberId: string) {
  return apply(await planUndoVisit(visitId), memberId, "Reverted");
}

// Recent actions' Revert on a System Update: the system goes back to the version before it.
export async function revertSystemUpdate(versionId: string, memberId: string) {
  const [version] = await db
    .select()
    .from(systemVersions)
    .where(and(eq(systemVersions.id, versionId), eq(systemVersions.state, "committed")));
  if (!version) throw new VersionError("That version is gone.");
  const [before] = await db
    .select()
    .from(systemVersions)
    .where(and(eq(systemVersions.systemId, version.systemId), eq(systemVersions.state, "committed"), lt(systemVersions.seq, version.seq ?? 0)))
    .orderBy(desc(systemVersions.seq))
    .limit(1);
  if (!before) throw new VersionError("This is the system's first version; there is nothing before it.");
  const r = await revertSystem(version.systemId, before.id, memberId);
  return {
    systemId: version.systemId,
    message: `Reverted to ${r.label}: ${r.moved} ${r.moved === 1 ? "part" : "parts"} changed.`,
  };
}

// The flipped arrow on a reverted System Update: the system goes back onto that version.
export async function reapplySystemUpdate(versionId: string, memberId: string) {
  const [version] = await db.select().from(systemVersions).where(and(eq(systemVersions.id, versionId), eq(systemVersions.state, "committed")));
  if (!version) throw new VersionError("That version is gone.");
  const r = await revertSystem(version.systemId, version.id, memberId);
  return { systemId: version.systemId, message: `Back on ${r.label}: ${r.moved} ${r.moved === 1 ? "part" : "parts"} changed.` };
}

// Undo (plan §8): the newest part edit this member made in the app in the last day that this
// tab hasn't undone yet (`exclude`: batches it undid, and the undo batches themselves).
export async function undoLatest(memberId: string, exclude: string[]) {
  const [latest] = await db
    .select({
      batchId: partHistory.batchId,
      at: sql<Date>`max(${partHistory.at})`,
    })
    .from(partHistory)
    .where(
      and(
        eq(partHistory.memberId, memberId),
        eq(partHistory.via, "ui"),
        gte(partHistory.at, new Date(Date.now() - 86_400_000)),
        exclude.length ? notInArray(partHistory.batchId, exclude) : undefined,
      ),
    )
    .groupBy(partHistory.batchId)
    .orderBy(desc(sql`max(${partHistory.at})`))
    .limit(1);
  if (!latest)
    return {
      message: "Nothing left to undo.",
      batchId: null,
      undone: null,
      skipped: 0,
    };
  const r = await apply(await planUndo(latest.batchId), memberId, "Undid");
  return { ...r, undone: latest.batchId };
}

// Redo: undoes an undo batch, only one of this member's own (a batch id from another tab or
// member isn't theirs to redo).
export async function redoBatch(batchId: string, memberId: string) {
  const [own] = await db
    .select({ batchId: partHistory.batchId })
    .from(partHistory)
    .where(and(eq(partHistory.batchId, batchId), eq(partHistory.memberId, memberId)))
    .limit(1);
  if (!own) return { message: "Nothing to redo.", batchId: null, skipped: 0 };
  return apply(await planUndo(batchId), memberId, "Redid");
}
