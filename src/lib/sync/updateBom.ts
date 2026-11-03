import "server-only";
import { and, count, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { checkSystem } from "@/lib/versions/detect";
import { commitDraft } from "@/lib/versions/commit";

export type SyncSummary = {
  // "review": too many parts would leave the BOM at once; the changes wait in the draft.
  skipped?: "unchanged" | "review";
  added: string[];
  updated: number;
  removed: string[];
  unknownMachines: string[];
  calls: number;
  version?: string; // the version the changes were committed as ("V70")
};

// Update BOM from Onshape in one step, for the MCP tool and linking a new assembly: checks for
// changes (plan/system-versioning.md §4) and commits all of them as the system's next version.
// Members in the app review the changes first (Update System → Commit window). With `force`
// false it stops after one call when the document didn't change.
export async function updateBomFromOnshape(
  systemId: string,
  memberId: string,
  { force = true, name }: { force?: boolean; name?: string } = {},
): Promise<SyncSummary> {
  const check = await checkSystem(systemId, memberId, { force });
  if (!check.draft) return { skipped: "unchanged", added: [], updated: 0, removed: [], unknownMachines: [], calls: check.calls };
  // An empty or cut-off BOM from Onshape (a suppressed subassembly, a broken reference, the wrong
  // configuration) would mark most of the system removed. Then nothing is committed without a
  // member: the changes stay in the draft for Update System's Commit window.
  const removed = check.draft.changes.filter((c) => c.change === "removed").map((c) => c.name);
  if (removed.length && (await tooManyRemoved(systemId, removed.length))) {
    return { skipped: "review", added: [], updated: 0, removed, unknownMachines: [], calls: check.calls };
  }
  const c = await commitDraft(systemId, memberId, { draftId: check.draft.id, name: name ?? check.draft.name });
  return { added: c.added, updated: c.updated, removed: c.removed, unknownMachines: c.unknownMachines, calls: check.calls, version: c.label };
}

// Every part, or at least 5 and more than a fifth of the system's parts from Onshape.
export const MASS_REMOVAL = { min: 5, share: 0.2 };
async function tooManyRemoved(systemId: string, removed: number) {
  const [row] = await db
    .select({ n: count() })
    .from(schema.parts)
    .where(and(eq(schema.parts.systemId, systemId), eq(schema.parts.isManual, false), isNull(schema.parts.removedFromCadAt)));
  const live = row?.n ?? 0;
  return removed >= live || (removed >= MASS_REMOVAL.min && removed > live * MASS_REMOVAL.share);
}
