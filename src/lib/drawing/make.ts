import "server-only";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { getMachine } from "@/config/machines";
import { db, schema } from "@/db";
import { onshapeClient } from "@/lib/onshape/client";
import { studioPath } from "@/lib/onshape/parts";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { type BodyDetails, readBodies, type TessellatedEdges } from "./brep";
import { READER, readPart } from "./read";
import type { TitleBlock } from "./types";

const { parts, systems, partDrawings } = schema;

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
    .select({ part: parts, drawingRev: partDrawings.rev, drawn: partDrawings.part })
    .from(parts)
    .leftJoin(partDrawings, eq(partDrawings.partId, parts.id))
    .where(and(eq(parts.systemId, systemId), inArray(parts.id, partIds)));

  const byStudio = new Map<string, typeof rows>();
  for (const r of rows) {
    const path = studioPath(r.part);
    if (!path || !ref) summary.skipped.push({ id: r.part.id, reason: "Not from Onshape" });
    else if (!force && r.drawingRev && r.drawingRev === r.part.thumbnailRev && r.drawn?.reader === READER) summary.made.push(r.part.id);
    else byStudio.set(path, [...(byStudio.get(path) ?? []), r]);
  }
  if (!byStudio.size) return summary;

  const client = onshapeClient(memberId, ref!.baseUrl);
  for (const [path, group] of byStudio) {
    if (Date.now() > deadline) {
      summary.left.push(...group.map((r) => r.part.id));
      continue;
    }
    const [details, edges] = await Promise.all([
      client.json<BodyDetails>(`partstudios/${path}/bodydetails`),
      client.json<TessellatedEdges>(`partstudios/${path}/tessellatededges?angleTolerance=0.1&chordTolerance=0.00005`),
    ]);
    const bodies = readBodies(details, edges);
    for (const r of group) {
      const body = bodies.find((b) => b.id === r.part.onshapePartId);
      const read = body && readPart(body);
      if (!read) {
        summary.skipped.push({ id: r.part.id, reason: body ? "Not a plate, tube or shaft" : "Not found in its Part Studio" });
        continue;
      }
      const values = { rev: r.part.thumbnailRev, part: read, updatedBy: memberId, updatedAt: new Date() };
      await db
        .insert(partDrawings)
        .values({ partId: r.part.id, ...values })
        .onConflictDoUpdate({ target: partDrawings.partId, set: values });
      summary.made.push(r.part.id);
    }
  }
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
  const processes = [part.preProcess, part.process1, part.process2, ...part.extraProcesses]
    .filter((p): p is string => !!p)
    .map((p) => getMachine(p)?.name ?? p);
  // The system's other parts, for "fit for <part>" notes in the editor.
  const others = await db
    .select({ displayName: schema.parts.displayName, onshapeName: schema.parts.onshapeName })
    .from(schema.parts)
    .where(and(eq(schema.parts.systemId, part.systemId!), ne(schema.parts.id, part.id), isNull(schema.parts.removedFromCadAt)));
  const title: TitleBlock = {
    name: part.displayName ?? part.onshapeName ?? "Unnamed part",
    ...(part.material ? { material: part.material } : {}),
    processes,
    quantity: part.quantity,
    system: row.system,
    robot: row.robot,
    ...(drawing.rev ? { revision: drawing.rev.slice(0, 8) } : {}),
    date: drawing.updatedAt.toISOString().slice(0, 10),
  };
  return {
    drawing,
    part,
    title,
    outdated: !!part.thumbnailRev && drawing.rev !== part.thumbnailRev,
    others: [...new Set(others.map((o) => o.displayName ?? o.onshapeName).filter((n): n is string => !!n))].sort(),
  };
}
