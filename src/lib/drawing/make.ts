import "server-only";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { COTS_PROCESS, getMachine } from "@/config/machines";
import { db, schema } from "@/db";
import { OnshapeError, onshapeClient } from "@/lib/onshape/client";
import { studioPath } from "@/lib/onshape/parts";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { versionLabel } from "@/lib/versions/label";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { imageUrl } from "@/lib/storage/r2";
import { type BodyDetails, readBodies, type TessellatedEdges } from "./brep";
import { READER, readPart } from "./read";
import type { TitleBlock } from "./types";

const { parts, systems, partDrawings } = schema;

const STUDIOS_AT_ONCE = 3;

export type MakeSummary = { made: string[]; skipped: { id: string; reason: string }[]; left: string[] };

// Drawings for the chosen parts of one system (plan/auto-drawings.md): 2 Onshape calls per Part
// Studio (its exact geometry), then each part is read and saved. A part whose drawing is
// already from its current revision (and this reader) is skipped unless `force` (Regenerate); its
// edits are kept when it's made again. Runs until `deadline`; the browser calls again with what's left.
export async function makeDrawings(systemId: string, partIds: string[], memberId: string, deadline: number, force = false): Promise<MakeSummary> {
  const summary: MakeSummary = { made: [], skipped: [], left: [] };
  if (!partIds.length) return summary;
  const [system] = await db.select({ assemblyUrl: systems.assemblyUrl }).from(systems).where(eq(systems.id, systemId));
  const ref = system?.assemblyUrl ? parseOnshapeUrl(system.assemblyUrl) : null;
  const rows = await db
    // The saved drawing's reader version only, not the drawing itself (its outlines are large).
    .select({ part: parts, drawingRev: partDrawings.rev, reader: sql<number | null>`(${partDrawings.part}->>'reader')::int` })
    .from(parts)
    .leftJoin(partDrawings, eq(partDrawings.partId, parts.id))
    .where(and(eq(parts.systemId, systemId), inArray(parts.id, partIds)));

  const byStudio = new Map<string, typeof rows>();
  for (const r of rows) {
    const path = studioPath(r.part);
    if (!path || !ref) summary.skipped.push({ id: r.part.id, reason: "Not from Onshape" });
    else if (!force && r.drawingRev && r.drawingRev === r.part.thumbnailRev && r.reader === READER) summary.made.push(r.part.id);
    else byStudio.set(path, [...(byStudio.get(path) ?? []), r]);
  }
  if (!byStudio.size) return summary;

  const client = onshapeClient(memberId, ref!.baseUrl);
  // Part Studios are read STUDIOS_AT_ONCE at a time: each is two Onshape answers that are mostly
  // waiting on Onshape, so one after another took a minute on a system of many studios.
  const queue = [...byStudio];
  const studio = async (path: string, group: typeof rows) => {
    // Only the chosen parts' geometry: a top-down Part Studio's every body is tens of MB and most
    // of a minute. Should Onshape leave a chosen part out, the whole studio is read once instead.
    const wanted = [...new Set(group.map((r) => r.part.onshapePartId!))];
    const fetchBodies = async (only: boolean) => {
      const q = (extra = "") => {
        const params = new URLSearchParams(extra);
        if (only) for (const id of wanted) params.append("partId", id);
        const s = params.toString();
        return s ? `?${s}` : "";
      };
      const [details, edges] = await Promise.all([
        client.json<BodyDetails>(`partstudios/${path}/bodydetails${q()}`),
        client.json<TessellatedEdges>(`partstudios/${path}/tessellatededges${q("angleTolerance=0.1&chordTolerance=0.00005")}`),
      ]);
      return readBodies(details, edges);
    };
    let bodies = await fetchBodies(true);
    if (wanted.some((id) => !bodies.some((b) => b.id === id && b.faces.length && b.edges.length))) bodies = await fetchBodies(false);
    const rowsToSave: (typeof partDrawings.$inferInsert)[] = [];
    for (const r of group) {
      const body = bodies.find((b) => b.id === r.part.onshapePartId);
      const read = body && readPart(body);
      if (!read) summary.skipped.push({ id: r.part.id, reason: body ? "Not a plate, tube or shaft" : "Not found in its Part Studio" });
      else rowsToSave.push({ partId: r.part.id, rev: r.part.thumbnailRev, part: read, updatedBy: memberId, updatedAt: new Date() });
    }
    if (rowsToSave.length) {
      // One write for the studio's parts; edits already saved are left as they are.
      await db
        .insert(partDrawings)
        .values(rowsToSave)
        .onConflictDoUpdate({
          target: partDrawings.partId,
          set: { rev: sql`excluded.rev`, part: sql`excluded.part`, updatedBy: sql`excluded.updated_by`, updatedAt: sql`excluded.updated_at` },
        });
      summary.made.push(...rowsToSave.map((r) => r.partId));
    }
  };
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [path, group] = next;
      if (Date.now() > deadline) summary.left.push(...group.map((r) => r.part.id));
      else
        await studio(path, group).catch((err) => {
          // One Part Studio Onshape can't answer for skips its parts; the others still get drawings.
          if (!(err instanceof OnshapeError)) throw err;
          summary.skipped.push(...group.map((r) => ({ id: r.part.id, reason: err.message })));
        });
    }
  };
  await Promise.all(Array.from({ length: Math.min(STUDIOS_AT_ONCE, queue.length) }, worker));
  return summary;
}

// A part's saved drawing with its BOM block filled from the part as it is now, and the system's
// other part names (for "fit for <part>" notes). A database read only.
export async function loadDrawing(partId: string) {
  const [row] = await db
    .select({ drawing: schema.partDrawings, part: schema.parts, system: schema.systems.name, robot: schema.robots.name })
    .from(schema.partDrawings)
    .innerJoin(schema.parts, eq(schema.parts.id, schema.partDrawings.partId))
    .innerJoin(schema.systems, eq(schema.systems.id, schema.parts.systemId))
    .innerJoin(schema.robots, eq(schema.robots.id, schema.systems.robotId))
    .where(eq(schema.partDrawings.partId, partId));
  if (!row) return null;
  const { part, drawing } = row;
  // Process 1, then the added processes (Harel, 2026-11-20).
  const processes = [part.process1, ...part.addedProcesses.map((p) => p.machine)]
    .filter((p): p is string => !!p)
    .map((p) => (p === COTS_PROCESS ? "COTS" : (getMachine(p)?.name ?? p)));
  // The system's other parts, for "fit for <part>" notes in the editor.
  const [others, version] = await Promise.all([
    db
      .select({ id: schema.parts.id, displayName: schema.parts.displayName, onshapeName: schema.parts.onshapeName, thumbnailRev: schema.parts.thumbnailRev })
      .from(schema.parts)
      .where(and(eq(schema.parts.systemId, part.systemId!), ne(schema.parts.id, part.id), isNull(schema.parts.removedFromCadAt))),
    partVersion(part.id, part.systemId!, part.versionRowId),
  ]);
  const title: TitleBlock = {
    name: part.displayName ?? part.onshapeName ?? "Unnamed part",
    ...(part.material ? { material: part.material } : {}),
    processes,
    quantity: part.quantity,
    system: row.system,
    robot: row.robot,
    ...(version ? { revision: version } : {}),
    date: drawing.updatedAt.toISOString().slice(0, 10),
  };
  return {
    drawing,
    part,
    title,
    outdated: !!part.thumbnailRev && drawing.rev !== part.thumbnailRev,
    others: [...new Set(others.map((o) => o.displayName ?? o.onshapeName).filter((n): n is string => !!n))].sort(),
    // The same parts with their ids and thumbnails, for the editor's Fit picker.
    fitParts: async () => {
      const named = others.filter((o) => o.displayName ?? o.onshapeName);
      const list = await Promise.all(
        named.map(async (o) => ({ id: o.id, name: (o.displayName ?? o.onshapeName)!, thumbUrl: o.thumbnailRev ? await imageUrl(thumbKey(o.id, o.thumbnailRev)) : null })),
      );
      return list.sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}

// The Onshape version the part card shows ("V82"): the system's version, or the part's own when
// a Revert or a partial commit left it behind its newest state. Database reads only.
async function partVersion(partId: string, systemId: string, rowId: string | null): Promise<string | null> {
  const { partVersions, systemVersions } = schema;
  const cols = { id: systemVersions.id, seq: systemVersions.seq, onshapeRef: systemVersions.onshapeRef };
  const [rows, [system], [latest]] = await Promise.all([
    db
      .select({ rowId: partVersions.id, ...cols })
      .from(partVersions)
      .innerJoin(systemVersions, eq(systemVersions.id, partVersions.versionId))
      .where(and(eq(partVersions.partId, partId), eq(systemVersions.state, "committed")))
      .orderBy(desc(systemVersions.seq)),
    db
      .select(cols)
      .from(systems)
      .innerJoin(systemVersions, eq(systemVersions.id, systems.currentVersionId))
      .where(eq(systems.id, systemId)),
    db
      .select(cols)
      .from(systemVersions)
      .where(and(eq(systemVersions.systemId, systemId), eq(systemVersions.state, "committed")))
      .orderBy(desc(systemVersions.seq))
      .limit(1),
  ]);
  const own = rows.find((r) => r.rowId === rowId);
  if (own && rows[0] && rows[0].rowId !== own.rowId) return versionLabel(own);
  const v = system ?? latest ?? own;
  return v ? versionLabel(v) : null;
}
