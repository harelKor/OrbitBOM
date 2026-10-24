import "server-only";
import { checkSystem } from "@/lib/versions/detect";
import { commitDraft } from "@/lib/versions/commit";

export type SyncSummary = {
  skipped?: "unchanged";
  added: string[];
  updated: number;
  removed: string[];
  unknownMachines: string[];
  calls: number;
  version?: number; // the version the changes were committed as
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
  const c = await commitDraft(systemId, memberId, { draftId: check.draft.id, name: name ?? check.draft.name });
  return { added: c.added, updated: c.updated, removed: c.removed, unknownMachines: c.unknownMachines, calls: check.calls, version: c.seq };
}
