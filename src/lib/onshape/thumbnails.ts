import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { onshapeClient, type OnshapeClient } from "@/lib/onshape/client";
import { apiPath, parseOnshapeUrl } from "@/lib/onshape/url";
import { deleteObject, putObject, storageConfigured } from "@/lib/storage/r2";
import { studioPath, thumbnailHref, type PartMetadata } from "./parts";

const { parts, robots, systems } = schema;

export const thumbKey = (partId: string, rev: string) => `thumbs/parts/${partId}/${rev}.png`;

export type ThumbSummary = { fetched: number; pending: number; calls: number; failed?: number; error?: string };

// Onshape can answer an Enterprise request with thumbnail links on cad.onshape.com; the same
// path works on the member's own Onshape host, where their token belongs.
function onOwnHost(href: string, baseUrl: string): string | null {
  const url = new URL(href, baseUrl);
  if (url.protocol !== "https:" || !/(^|\.)onshape\.com$/i.test(url.hostname)) return null;
  const base = new URL(baseUrl);
  url.protocol = base.protocol;
  url.host = base.host;
  return url.toString();
}

// Part thumbnails (plan §4): one parts-list call per Part Studio tells us each part's
// microversion; only parts whose microversion changed fetch a new image (one call each), and
// the image is kept in R2. Stops at `deadline` so a request stays inside Vercel's time limit;
// what's left is fetched on the next Update BOM. A Part Studio or image that fails is skipped
// and counted, so one bad part never hides every other thumbnail.
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
  const fail = (err: unknown) => {
    summary.failed = (summary.failed ?? 0) + 1;
    summary.error ??= err instanceof Error ? err.message : String(err);
  };
  // Each Part Studio's parts list, a few at a time.
  const studioQueue = [...studios];
  const listWorker = async () => {
    for (let next = studioQueue.shift(); next; next = studioQueue.shift()) {
      const [path, studioParts] = next;
      if (Date.now() > deadline) {
        summary.pending += studioParts.filter((p) => !p.thumbnailRev).length;
        continue;
      }
      let metas: PartMetadata[];
      try {
        metas = await client.json<PartMetadata[]>(`parts/${path}?withThumbnails=true`);
      } catch (err) {
        fail(err);
        continue;
      }
      for (const part of studioParts) {
        const meta = metas.find((m) => m.partId === part.onshapePartId);
        const link = meta && thumbnailHref(meta);
        const href = link && onOwnHost(link, ref.baseUrl);
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
  };
  await Promise.all(Array.from({ length: 4 }, listWorker));

  // A few at a time, to be quick without hammering Onshape.
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (Date.now() > deadline) {
        summary.pending++;
        continue;
      }
      try {
        const res = await client.raw(job.href, { headers: { Accept: "image/*" } });
        await putObject(thumbKey(job.part.id, job.rev), await res.arrayBuffer(), res.headers.get("content-type") ?? "image/png");
        await db.update(parts).set({ thumbnailRev: job.rev }).where(eq(parts.id, job.part.id));
        if (job.part.thumbnailRev) await deleteObject(thumbKey(job.part.id, job.part.thumbnailRev));
        summary.fetched++;
      } catch (err) {
        fail(err);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  // The picture of the whole subsystem, and of the whole robot, for the sidebar tiles.
  if (Date.now() < deadline) {
    const path = await assemblyThumbnail(client, system.assemblyUrl!, `thumbs/systems/${systemId}`, system.thumbnailPath);
    if (path !== system.thumbnailPath) await db.update(systems).set({ thumbnailPath: path }).where(eq(systems.id, systemId));
    const [robot] = await db.select().from(robots).where(eq(robots.id, system.robotId));
    const main = robot?.mainAssemblyUrl ? parseOnshapeUrl(robot.mainAssemblyUrl) : null;
    if (robot && main?.baseUrl === ref.baseUrl) {
      const robotPath = await assemblyThumbnail(client, robot.mainAssemblyUrl!, `thumbs/robots/${robot.id}`, robot.thumbnailPath);
      if (robotPath !== robot.thumbnailPath) await db.update(robots).set({ thumbnailPath: robotPath }).where(eq(robots.id, robot.id));
    }
  }
  summary.calls = client.calls;
  return summary;
}

// An assembly's own Onshape thumbnail, kept in R2 under `prefix` and named by its content, so
// an unchanged picture is never stored twice. Returns the path to keep (the current one when
// the assembly has no thumbnail or Onshape refuses).
async function assemblyThumbnail(client: OnshapeClient, url: string, prefix: string, current: string | null): Promise<string | null> {
  const ref = parseOnshapeUrl(url);
  if (!ref?.eid || ref.wvm === "m") return current;
  try {
    const res = await client.raw(`thumbnails/${apiPath(ref)}/s/300x300`, { headers: { Accept: "image/*" } });
    const body = await res.arrayBuffer();
    const path = `${prefix}/${createHash("sha1").update(new Uint8Array(body)).digest("hex").slice(0, 16)}.png`;
    if (path === current) return current;
    await putObject(path, body, res.headers.get("content-type") ?? "image/png");
    if (current) await deleteObject(current);
    return path;
  } catch (err) {
    console.warn("Assembly thumbnail skipped", err instanceof Error ? err.message : err);
    return current;
  }
}
