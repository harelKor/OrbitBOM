import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { onshapeClient } from "@/lib/onshape/client";
import { studioPath } from "@/lib/onshape/parts";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { type BodyDetails, readBodies, type TessellatedEdges } from "./brep";
import { readPart } from "./read";

const { parts, systems, partDrawings } = schema;

export type MakeSummary = { made: string[]; skipped: { id: string; reason: string }[]; left: string[] };

// Drawings for the chosen parts of one system (plan/auto-drawings.md): 2 Onshape calls per Part
// Studio (its exact geometry), then each part is read and saved. A part whose drawing is
// already from its current revision is skipped; its edits are kept when it's made again.
// Runs until `deadline`; the browser calls again with what's left.
export async function makeDrawings(systemId: string, partIds: string[], memberId: string, deadline: number): Promise<MakeSummary> {
  const summary: MakeSummary = { made: [], skipped: [], left: [] };
  if (!partIds.length) return summary;
  const [system] = await db.select({ assemblyUrl: systems.assemblyUrl }).from(systems).where(eq(systems.id, systemId));
  const ref = system?.assemblyUrl ? parseOnshapeUrl(system.assemblyUrl) : null;
  const rows = await db
    .select({ part: parts, drawingRev: partDrawings.rev })
    .from(parts)
    .leftJoin(partDrawings, eq(partDrawings.partId, parts.id))
    .where(and(eq(parts.systemId, systemId), inArray(parts.id, partIds)));

  const byStudio = new Map<string, typeof rows>();
  for (const r of rows) {
    const path = studioPath(r.part);
    if (!path || !ref) summary.skipped.push({ id: r.part.id, reason: "Not from Onshape" });
    else if (r.drawingRev && r.drawingRev === r.part.thumbnailRev) summary.made.push(r.part.id);
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
