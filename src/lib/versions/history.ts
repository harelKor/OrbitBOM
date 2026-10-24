import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PartSnapshot, VersionChange } from "@/db/schema";
import { planPartUpdate, ONSHAPE_FIELDS, type PartChanges } from "@/lib/parts/changes";
import { VersionError } from "./commit";
import { versionLabel } from "./label";
import { sameState } from "./snapshot";

const { members, parts, partHistory, partVersions, systems, systemVersions } = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = Tx | typeof db;

export type Row = { id: string; partId: string; versionId: string; seq: number; change: string; snapshot: PartSnapshot };

// Every committed part state of a system, oldest version first.
async function rowsOf(x: Exec, systemId: string): Promise<Row[]> {
  const rows = await x
    .select({ id: partVersions.id, partId: partVersions.partId, versionId: partVersions.versionId, seq: systemVersions.seq, change: partVersions.change, snapshot: partVersions.snapshot })
    .from(partVersions)
    .innerJoin(systemVersions, eq(systemVersions.id, partVersions.versionId))
    .where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "committed")));
  return rows.map((r) => ({ ...r, seq: r.seq ?? 0 })).sort((a, b) => a.seq - b.seq);
}

// The parts held behind the latest version (plan/system-versioning.md §6): after a Revert, a
// part whose committed state differs from its newest one. Part id → its newest state. Checks
// leave these parts alone, so a Revert sticks until the part is updated.
export async function heldParts(x: Exec, systemId: string): Promise<Map<string, Row>> {
  const [rows, pointers] = await Promise.all([
    rowsOf(x, systemId),
    x.select({ id: parts.id, rowId: parts.versionRowId }).from(parts).where(and(eq(parts.systemId, systemId), eq(parts.isManual, false))),
  ]);
  const latest = new Map<string, Row>();
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) latest.set(r.partId, r);
  const held = new Map<string, Row>();
  for (const p of pointers) {
    const newest = latest.get(p.id);
    if (!newest || newest.id === p.rowId) continue;
    const at = p.rowId ? byId.get(p.rowId) : undefined;
    const differs = !at || at.change === "removed" || newest.change === "removed" || !sameState(at.snapshot, newest.snapshot);
    if (differs) held.set(p.id, newest);
  }
  return held;
}

export type VersionEntry = {
  id: string;
  seq: number;
  label: string; // "V70"
  name: string | null;
  at: string | null;
  by: string | null;
  changes: (VersionChange & { rowId: string | null })[];
};

export type VersionList = { versions: VersionEntry[]; currentId: string | null; latestId: string | null };

// The Versions window: every committed version, newest first, with its parts' changes. A
// database read only.
export async function listVersions(systemId: string): Promise<VersionList> {
  const [versions, rows, [system]] = await Promise.all([
    db
      .select({ v: systemVersions, by: members.name })
      .from(systemVersions)
      .leftJoin(members, eq(members.id, systemVersions.committedBy))
      .where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "committed")))
      .orderBy(desc(systemVersions.seq)),
    rowsOf(db, systemId),
    db.select({ currentVersionId: systems.currentVersionId }).from(systems).where(eq(systems.id, systemId)),
  ]);
  const rowOf = new Map(rows.map((r) => [`${r.versionId}|${r.partId}`, r.id]));
  return {
    versions: versions.map(({ v, by }) => ({
      id: v.id,
      seq: v.seq ?? 0,
      label: versionLabel(v),
      name: v.name,
      at: v.committedAt?.toISOString() ?? null,
      by,
      changes: v.changes.map((c) => ({ ...c, rowId: c.partId ? (rowOf.get(`${v.id}|${c.partId}`) ?? null) : null })),
    })),
    currentId: system?.currentVersionId ?? versions[0]?.v.id ?? null,
    latestId: versions[0]?.v.id ?? null,
  };
}

// Puts a part on a committed state: its Onshape fields (those the team didn't override),
// reference and shape, or hides it for a state where it isn't in the assembly. App data
// (status, notes, counters…) is never touched. History rows go into `batchId`.
async function pointPart(tx: Tx, part: typeof parts.$inferSelect, row: Row | null, memberId: string, batchId: string) {
  const now = new Date();
  if (!row || row.change === "removed") {
    await tx
      .update(parts)
      .set({ removedFromCadAt: part.removedFromCadAt ?? now, versionRowId: row?.id ?? null })
      .where(eq(parts.id, part.id));
    return;
  }
  const s = row.snapshot;
  const changes: PartChanges = {};
  for (const field of ONSHAPE_FIELDS) {
    if (!part.overriddenFields.includes(field) && part[field] !== s[field]) Object.assign(changes, { [field]: s[field] });
  }
  const { set, history } = planPartUpdate(part, changes, "sync");
  await tx
    .update(parts)
    .set({
      ...set,
      sourceDid: s.sourceDid,
      sourceWid: s.sourceWid,
      sourceWvm: s.sourceWvm,
      sourceEid: s.sourceEid,
      onshapePartId: s.onshapePartId,
      onshapeName: s.onshapeName,
      shapeSig: s.sig ?? part.shapeSig,
      geometry: { ...(part.geometry ?? {}), onshapeMaterial: s.onshapeMaterial ?? undefined },
      removedFromCadAt: null,
      versionRowId: row.id,
      ...(history.length ? { lastModifiedAt: now, lastModifiedBy: memberId } : {}),
    })
    .where(eq(parts.id, part.id));
  if (history.length) await tx.insert(partHistory).values(history.map((h) => ({ partId: part.id, ...h, memberId, via: "sync" as const, batchId })));
}

// Revert (plan/system-versioning.md §6): every part goes back to its state in the version, parts
// added since are hidden and parts removed since come back. No new version is made: the newer
// ones stay, and the parts that differ from them are Outdated. Onshape isn't touched. A waiting
// draft is dropped; the next check lists only what is new in Onshape.
export async function revertSystem(systemId: string, versionId: string, memberId: string) {
  return db.transaction(async (tx) => {
    const [system] = await tx.select().from(systems).where(eq(systems.id, systemId)).for("update");
    const [version] = await tx
      .select()
      .from(systemVersions)
      .where(and(eq(systemVersions.id, versionId), eq(systemVersions.systemId, systemId), eq(systemVersions.state, "committed")));
    if (!system || !version) throw new VersionError("That version is gone.");
    const seq = version.seq ?? 0;
    const rows = await rowsOf(tx, systemId);
    const target = new Map<string, Row>();
    for (const r of rows) if (r.seq <= seq) target.set(r.partId, r);
    const touched = [...new Set(rows.map((r) => r.partId))];
    const list = touched.length ? await tx.select().from(parts).where(inArray(parts.id, touched)) : [];
    const batchId = randomUUID();
    let moved = 0;
    for (const part of list) {
      const row = target.get(part.id) ?? null;
      if ((row?.id ?? null) === part.versionRowId) continue;
      await pointPart(tx, part, row, memberId, batchId);
      moved++;
    }
    await tx.delete(systemVersions).where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "draft")));
    await tx.update(systems).set({ currentVersionId: version.id }).where(eq(systems.id, systemId));
    return { label: versionLabel(version), moved };
  });
}

// An Outdated part's Update after a Revert: the part takes its newest committed state. When no
// part is held back any more, the system is on its latest version again.
export async function updatePartToLatest(systemId: string, partId: string, memberId: string) {
  return db.transaction(async (tx) => {
    await tx.select({ id: systems.id }).from(systems).where(eq(systems.id, systemId)).for("update");
    const held = await heldParts(tx, systemId);
    const row = held.get(partId);
    if (!row) throw new VersionError("This part is already up to date.");
    const [part] = await tx.select().from(parts).where(eq(parts.id, partId));
    await pointPart(tx, part, row, memberId, randomUUID());
    if (held.size === 1) {
      const [latest] = await tx
        .select({ id: systemVersions.id })
        .from(systemVersions)
        .where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "committed")))
        .orderBy(desc(systemVersions.seq))
        .limit(1);
      if (latest) await tx.update(systems).set({ currentVersionId: latest.id }).where(eq(systems.id, systemId));
    }
  });
}
