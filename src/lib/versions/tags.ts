import "server-only";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { VersionRef } from "@/db/schema";
import { heldParts } from "./history";
import { versionLabel } from "./label";

const { members, parts, partVersions, systemVersions } = schema;

export type PartVersionTag = { seq: number; label: string; name: string | null; at: string | null; by: string | null };

// Why a part is Outdated and the update it missed: a change in a draft whose other parts were
// committed one at a time (`key`, committed from the draft), or a newer committed state a
// Revert held it back from.
export type OutdatedTag = { key?: string; missed: PartVersionTag | null };

// What the part cards' Up to date / Outdated tags show (plan/system-versioning.md §7). A
// database read only.
export type VersionTags = {
  systemId: string;
  parts: Record<string, PartVersionTag>;
  outdated: Record<string, OutdatedTag>;
  draft: { id: string; detectedAt: string } | null;
  // The system's version, which every Up to date part shows, and its latest one when a Revert
  // put it behind (Back to latest).
  current: PartVersionTag | null;
  latest: (PartVersionTag & { id: string }) | null;
};

type VersionRow = { seq: number | null; onshapeRef: VersionRef | null; name: string | null; at: Date | null; by: string | null };
const tag = (r: VersionRow): PartVersionTag => ({
  seq: r.seq ?? 0,
  label: versionLabel(r),
  name: r.name,
  at: r.at?.toISOString() ?? null,
  by: r.by,
});
const versionCols = { id: systemVersions.id, seq: systemVersions.seq, onshapeRef: systemVersions.onshapeRef, name: systemVersions.name, at: systemVersions.committedAt, by: members.name };

export async function loadVersionTags(systemId: string): Promise<VersionTags> {
  const [rows, [draft], held, [system], [latest]] = await Promise.all([
    db
      .select({ partId: parts.id, ...versionCols })
      .from(parts)
      .innerJoin(partVersions, eq(partVersions.id, parts.versionRowId))
      .innerJoin(systemVersions, eq(systemVersions.id, partVersions.versionId))
      .leftJoin(members, eq(members.id, systemVersions.committedBy))
      .where(and(eq(parts.systemId, systemId), isNotNull(parts.versionRowId))),
    db
      .select()
      .from(systemVersions)
      .where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "draft"))),
    heldParts(db, systemId),
    db.select({ currentVersionId: schema.systems.currentVersionId }).from(schema.systems).where(eq(schema.systems.id, systemId)),
    db
      .select(versionCols)
      .from(systemVersions)
      .leftJoin(members, eq(members.id, systemVersions.committedBy))
      .where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "committed")))
      .orderBy(desc(systemVersions.seq))
      .limit(1),
  ]);
  const currentId = system?.currentVersionId ?? latest?.id ?? null;

  const ids = [...new Set([...(currentId ? [currentId] : []), ...[...held.values()].map((r) => r.versionId), ...(draft?.partialVersionId ? [draft.partialVersionId] : [])])];
  const versions = ids.length
    ? await db.select(versionCols).from(systemVersions).leftJoin(members, eq(members.id, systemVersions.committedBy)).where(inArray(systemVersions.id, ids))
    : [];
  const byId = new Map(versions.map((v) => [v.id, tag(v)]));

  const outdated: Record<string, OutdatedTag> = {};
  for (const [partId, row] of held) outdated[partId] = { missed: byId.get(row.versionId) ?? null };
  if (draft?.partialVersionId) {
    for (const c of draft.changes) if (c.partId) outdated[c.partId] = { key: c.key, missed: byId.get(draft.partialVersionId) ?? null };
  }
  return {
    systemId,
    parts: Object.fromEntries(rows.map((r) => [r.partId, tag(r)])),
    outdated,
    draft: draft ? { id: draft.id, detectedAt: draft.detectedAt.toISOString() } : null,
    current: currentId ? (byId.get(currentId) ?? null) : null,
    latest: latest && latest.id !== currentId ? { ...tag(latest), id: latest.id } : null,
  };
}
