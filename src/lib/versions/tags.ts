import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";

const { members, parts, partVersions, systemVersions } = schema;

export type PartVersionTag = { seq: number; name: string | null; at: string | null; by: string | null };

// What the part cards' Up to date / Outdated tags show (plan/system-versioning.md §7): each
// part's committed version, and the parts left Outdated by a draft whose other parts were
// committed one at a time. A database read only.
export type VersionTags = {
  systemId: string;
  parts: Record<string, PartVersionTag>;
  outdated: Record<string, string>; // part id → its change's key in the draft
  draft: { id: string; detectedAt: string } | null;
  missed: PartVersionTag | null; // the version the Outdated parts' siblings went into
};

export async function loadVersionTags(systemId: string): Promise<VersionTags> {
  const [rows, [draft]] = await Promise.all([
    db
      .select({ partId: parts.id, seq: systemVersions.seq, name: systemVersions.name, at: systemVersions.committedAt, by: members.name })
      .from(parts)
      .innerJoin(partVersions, eq(partVersions.id, parts.versionRowId))
      .innerJoin(systemVersions, eq(systemVersions.id, partVersions.versionId))
      .leftJoin(members, eq(members.id, systemVersions.committedBy))
      .where(and(eq(parts.systemId, systemId), isNotNull(parts.versionRowId))),
    db
      .select()
      .from(systemVersions)
      .where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "draft"))),
  ]);
  const tag = (r: { seq: number | null; name: string | null; at: Date | null; by: string | null }): PartVersionTag => ({
    seq: r.seq ?? 0,
    name: r.name,
    at: r.at?.toISOString() ?? null,
    by: r.by,
  });

  let missed: PartVersionTag | null = null;
  const outdated: Record<string, string> = {};
  if (draft?.partialVersionId) {
    const [v] = await db
      .select({ seq: systemVersions.seq, name: systemVersions.name, at: systemVersions.committedAt, by: members.name })
      .from(systemVersions)
      .leftJoin(members, eq(members.id, systemVersions.committedBy))
      .where(inArray(systemVersions.id, [draft.partialVersionId]));
    if (v) missed = tag(v);
    for (const c of draft.changes) if (c.partId) outdated[c.partId] = c.key;
  }
  return {
    systemId,
    parts: Object.fromEntries(rows.map((r) => [r.partId, tag(r)])),
    outdated,
    draft: draft ? { id: draft.id, detectedAt: draft.detectedAt.toISOString() } : null,
    missed,
  };
}
