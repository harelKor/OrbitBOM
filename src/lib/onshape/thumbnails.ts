import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { logCalls, onshapeClient } from "@/lib/onshape/client";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { studioPath } from "./parts";
import { partsList } from "./partsList";
import { studioStates } from "./studioRevs";

const { parts, systems } = schema;

// Part, system and robot pictures are drawn in a CAD member's browser from the 3D model's meshes
// (src/components/viewer/pictures.ts, Harel 2026-11-11): Onshape's own thumbnails cost a call
// each, and drawing them ourselves makes every picture look like the 3D view.
export const thumbKey = (partId: string, rev: string) => `thumbs/parts/${partId}/${rev}.png`;

export type PartDataSummary = { calls: number; studios: number };

// What the export files and the BOM need from each Part Studio's parts list: a sheet metal part's
// flat pattern (its DXF) and the body type. One call per Part Studio state, kept (partsList.ts),
// so a Part Studio nobody edited costs nothing. `only`: just these studio paths (the ones a commit
// changed); otherwise every Part Studio of the system. A Part Studio that fails is skipped.
export async function refreshPartData(systemId: string, memberId: string, { only }: { only?: Set<string> } = {}): Promise<PartDataSummary> {
  const summary: PartDataSummary = { calls: 0, studios: 0 };
  const [system] = await db.select().from(systems).where(eq(systems.id, systemId));
  const ref = system?.assemblyUrl ? parseOnshapeUrl(system.assemblyUrl) : null;
  if (!ref) return summary;
  const client = onshapeClient(memberId, ref.baseUrl);

  const rows = await db
    .select()
    .from(parts)
    .where(and(eq(parts.systemId, systemId), isNull(parts.removedFromCadAt), isNotNull(parts.onshapePartId)));
  const studios = new Map<string, typeof rows>();
  for (const p of rows) {
    const path = studioPath(p);
    if (path && (!only || only.has(path))) studios.set(path, [...(studios.get(path) ?? []), p]);
  }
  if (!studios.size) return summary;
  const states = await studioStates(client, studios.keys());

  const queue = [...studios];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [path, studioParts] = next;
      let listed;
      try {
        listed = await partsList(client, path, states.get(path) ?? null);
      } catch (err) {
        console.warn("Parts list skipped", path, err instanceof Error ? err.message : err);
        continue;
      }
      summary.studios++;
      const flatOf = new Map(listed.filter((m) => m.isFlattenedBody && m.unflattenedPartId).map((m) => [m.unflattenedPartId!, m.partId]));
      for (const part of studioParts) {
        const meta = listed.find((m) => m.partId === part.onshapePartId && !m.isFlattenedBody);
        if (!meta) continue;
        const flatPartId = flatOf.get(meta.partId);
        const geometry = { ...(part.geometry ?? {}), ...(meta.bodyType ? { bodyType: meta.bodyType } : {}) };
        if (flatPartId) geometry.sheetMetal = { flatPartId };
        else delete geometry.sheetMetal;
        if (JSON.stringify(geometry) !== JSON.stringify(part.geometry ?? {})) {
          await db.update(parts).set({ geometry }).where(eq(parts.id, part.id));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  summary.calls = client.calls;
  logCalls("part-data", client);
  return summary;
}
