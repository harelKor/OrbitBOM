import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { systems, systemVersions } = schema;

// A system's version state for the right panel and the dashboard's Sync box
// (plan/system-versioning.md §7): Outdated when it was reverted behind its latest version or
// some of its parts were committed one at a time; `waiting` counts the changes found in Onshape
// and not committed yet. A database read only.
export type SystemSync = { outdated: "reverted" | "partial" | null; waiting: number };

// `systemRows`: the systems already read by the caller (the right panel), so they aren't read twice.
export async function listSystemSync(systemRows?: { id: string; currentVersionId: string | null }[]): Promise<Map<string, SystemSync>> {
  const [rows, latest, drafts] = await Promise.all([
    systemRows ?? db.select({ id: systems.id, currentVersionId: systems.currentVersionId }).from(systems),
    db
      .selectDistinctOn([systemVersions.systemId], { systemId: systemVersions.systemId, id: systemVersions.id })
      .from(systemVersions)
      .where(eq(systemVersions.state, "committed"))
      .orderBy(systemVersions.systemId, desc(systemVersions.seq)),
    db
      .select({
        systemId: systemVersions.systemId,
        partial: systemVersions.partialVersionId,
        count: sql<number>`jsonb_array_length(${systemVersions.changes})::int`,
      })
      .from(systemVersions)
      .where(eq(systemVersions.state, "draft")),
  ]);
  const latestOf = new Map(latest.map((l) => [l.systemId, l.id]));
  const draftOf = new Map(drafts.map((d) => [d.systemId, d]));
  return new Map(
    rows.map((s) => {
      const draft = draftOf.get(s.id);
      const reverted = !!s.currentVersionId && latestOf.has(s.id) && latestOf.get(s.id) !== s.currentVersionId;
      const outdated = reverted ? "reverted" : draft?.partial ? "partial" : null;
      return [s.id, { outdated, waiting: draft?.count ?? 0 }];
    }),
  );
}
