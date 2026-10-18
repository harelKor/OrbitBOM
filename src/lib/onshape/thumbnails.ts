import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { onshapeClient } from "@/lib/onshape/client";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { deleteObject, putObject, storageConfigured } from "@/lib/storage/r2";
import { studioPath, thumbnailHref, type PartMetadata } from "./parts";

const { parts, systems } = schema;

export const thumbKey = (partId: string, rev: string) => `thumbs/parts/${partId}/${rev}.png`;

export type ThumbSummary = { fetched: number; pending: number; calls: number };

// Part thumbnails (plan §4): one parts-list call per Part Studio tells us each part's
// microversion; only parts whose microversion changed fetch a new image (one call each), and
// the image is kept in R2. Stops at `deadline` so a request stays inside Vercel's time limit;
// what's left is fetched on the next Update BOM.
export async function refreshThumbnails(systemId: string, memberId: string, deadline: number): Promise<ThumbSummary> {
  const summary: ThumbSummary = { fetched: 0, pending: 0, calls: 0 };
  if (!storageConfigured()) return summary;
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
    if (path) studios.set(path, [...(studios.get(path) ?? []), p]);
  }

  const queue: { part: (typeof rows)[number]; href: string; rev: string }[] = [];
  for (const [path, studioParts] of studios) {
    if (Date.now() > deadline) break;
    const metas = await client.json<PartMetadata[]>(`parts/${path}?withThumbnails=true`);
    for (const part of studioParts) {
      const meta = metas.find((m) => m.partId === part.onshapePartId);
      const href = meta && thumbnailHref(meta);
      if (!meta || !href) continue;
      const rev = meta.microversionId ?? createHash("sha1").update(href).digest("hex").slice(0, 16);
      if (meta.bodyType && part.geometry?.bodyType !== meta.bodyType) {
        await db
          .update(parts)
          .set({ geometry: { ...(part.geometry ?? {}), bodyType: meta.bodyType } })
          .where(eq(parts.id, part.id));
      }
      if (part.thumbnailRev !== rev) queue.push({ part, href, rev });
    }
  }

  // A few at a time, to be quick without hammering Onshape.
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (Date.now() > deadline) {
        summary.pending++;
        continue;
      }
      const res = await client.raw(job.href, { headers: { Accept: "image/*" } });
      await putObject(thumbKey(job.part.id, job.rev), await res.arrayBuffer(), res.headers.get("content-type") ?? "image/png");
      await db.update(parts).set({ thumbnailRev: job.rev }).where(eq(parts.id, job.part.id));
      if (job.part.thumbnailRev) await deleteObject(thumbKey(job.part.id, job.part.thumbnailRev));
      summary.fetched++;
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  summary.calls = client.calls;
  return summary;
}
