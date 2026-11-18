import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { imageHash } from "@/lib/images/dhash";
import { hasCapability } from "@/lib/mode";
import { robotModel } from "@/lib/model/build";
import { partKey } from "@/lib/model/assembly";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { cachedPayloads, keepPayload } from "@/lib/onshape/studioRevs";
import { deleteObject, putObject, storageConfigured } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";
import type { PictureJobs } from "@/components/viewer/pictures";

const { parts, partDrawings, robots, systems } = schema;

// The pictures drawn in a CAD member's browser from the 3D model (src/components/viewer/pictures.ts,
// Harel 2026-11-11): GET says which are missing or out of date, POST stores them. No Onshape calls.
// A part's picture is redrawn when the Part Studio file it comes from changed since it was drawn
// (kept per robot under "pictures:<robotId>"); a system's and the robot's when their placements
// or files did (their file is named by that).

type Drawn = Record<string, string>; // part id → the Part Studio file its picture was checked against
const drawnKey = (robotId: string) => `pictures:${robotId}`;
const pictureRev = (lines: string[]) => createHash("sha1").update(`pic1|${lines.join("\n")}`).digest("hex").slice(0, 16);

async function plan(robotId: string, systemId: string | null) {
  // Pictures show the parts as the BOM has them (Harel, 2026-11-18).
  const model = await robotModel(robotId, undefined, "bom");
  if (!model) return null;
  const [robot] = await db.select({ thumbnailPath: robots.thumbnailPath }).from(robots).where(eq(robots.id, robotId));
  const rows = await db
    .select({ id: parts.id, systemId: parts.systemId, did: parts.sourceDid, eid: parts.sourceEid, partId: parts.onshapePartId, rev: parts.thumbnailRev })
    .from(parts)
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .where(and(eq(systems.robotId, robotId), systemId ? eq(parts.systemId, systemId) : undefined, isNull(parts.removedFromCadAt), isNotNull(parts.onshapePartId)));
  const drawn = (await cachedPayloads<Drawn>([drawnKey(robotId)])).get(drawnKey(robotId)) ?? {};
  const studioOf = new Map<string, number>();
  for (const p of model.placements) if (!studioOf.has(p.k)) studioOf.set(p.k, p.s);

  const jobs: PictureJobs = { studios: model.studios, keys: model.keys, placements: model.placements, parts: [], systems: [], robot: null };
  for (const r of rows) {
    if (!r.did || !r.eid || !r.partId) continue;
    const s = studioOf.get(partKey(r.did, r.eid, r.partId));
    if (s === undefined) continue;
    if (r.rev && drawn[r.id] === model.keys[s]) continue;
    jobs.parts.push({ id: r.id, s, partId: r.partId, rev: r.rev });
  }
  const lines = (keep: (g: number | undefined) => boolean) =>
    model.placements.filter((p) => keep(p.g)).map((p) => `${model.keys[p.s]}|${p.k}|${p.t.join(",")}`);
  const groupSystems = model.groups.flatMap((g, i) => g.systemIds.map((id) => ({ id, g: i })));
  const wanted = groupSystems.filter((x) => !systemId || x.id === systemId);
  const paths = wanted.length ? await db.select({ id: systems.id, path: systems.thumbnailPath }).from(systems).where(inArray(systems.id, wanted.map((x) => x.id))) : [];
  for (const x of wanted) {
    const rev = pictureRev(lines((g) => g === x.g));
    if (paths.find((p) => p.id === x.id)?.path !== `thumbs/systems/${x.id}/${rev}.png`) jobs.systems.push({ id: x.id, g: x.g, rev });
  }
  // The robot's picture needs every file of the model: only from the robot's own page.
  if (!systemId) {
    const rev = pictureRev(lines(() => true));
    if (robot?.thumbnailPath !== `thumbs/robots/${robotId}/${rev}.png`) jobs.robot = { rev };
  }
  return { jobs, drawn, studioOf, rows };
}

async function allowed(robotId: string) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await hasCapability("sync"))) return NextResponse.json(null);
  if (!isUuid(robotId) || !storageConfigured()) return NextResponse.json(null);
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  const denied = await allowed(robotId);
  if (denied) return denied;
  const system = new URL(request.url).searchParams.get("system");
  const p = await plan(robotId, system && isUuid(system) ? system : null);
  return NextResponse.json(p?.jobs ?? null);
}

const REV = /^g[0-9a-f]{16}$/;
const PATH_REV = /^[0-9a-f]{16}$/;

export async function POST(request: Request, { params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  const denied = await allowed(robotId);
  if (denied) return denied;
  const p = await plan(robotId, null);
  if (!p) return NextResponse.json({ stored: 0 });
  const form = await request.formData();
  const byId = new Map(p.rows.map((r) => [r.id, r]));
  const fileOf = (id: string) => {
    const r = byId.get(id);
    const s = r?.did && r.eid && r.partId ? p.studioOf.get(partKey(r.did, r.eid, r.partId)) : undefined;
    return s === undefined ? null : p.jobs.keys[s];
  };
  const drawn = { ...p.drawn };
  let stored = 0;

  for (const [name, value] of form) {
    const [kind, id, rev] = name.split(":");
    const bytes = typeof value === "string" ? null : new Uint8Array(await value.arrayBuffer());
    if (bytes && (bytes.byteLength > 2_000_000 || !isPng(bytes))) continue;
    if (kind === "same" && isUuid(id)) {
      // Same mesh as its picture: only note the file it was checked against.
      const file = fileOf(id);
      if (file) drawn[id] = file;
    } else if (kind === "part" && isUuid(id) && REV.test(rev ?? "") && bytes) {
      const file = fileOf(id);
      if (!file) continue;
      await storePartPicture(id, rev, bytes);
      drawn[id] = file;
      stored++;
    } else if (kind === "system" && isUuid(id) && PATH_REV.test(rev ?? "") && bytes) {
      if (!p.jobs.systems.some((s) => s.id === id)) continue;
      const path = `thumbs/systems/${id}/${rev}.png`;
      await putObject(path, bytes, "image/png");
      const [old] = await db.select({ path: systems.thumbnailPath }).from(systems).where(eq(systems.id, id));
      await db.update(systems).set({ thumbnailPath: path }).where(eq(systems.id, id));
      if (old?.path && old.path !== path) await deleteObject(old.path).catch(() => {});
      stored++;
    } else if (kind === "robot" && PATH_REV.test(id ?? "") && bytes) {
      const path = `thumbs/robots/${robotId}/${id}.png`;
      await putObject(path, bytes, "image/png");
      const [old] = await db.select({ path: robots.thumbnailPath }).from(robots).where(eq(robots.id, robotId));
      await db.update(robots).set({ thumbnailPath: path }).where(eq(robots.id, robotId));
      if (old?.path && old.path !== path) await deleteObject(old.path).catch(() => {});
      stored++;
    }
  }
  await keepPayload(drawnKey(robotId), drawn);
  if (stored) revalidatePath("/robots", "layout");
  return NextResponse.json({ stored });
}

const isPng = (b: Uint8Array) => b.byteLength > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

async function storePartPicture(partId: string, rev: string, bytes: Uint8Array) {
  const [part] = await db.select().from(parts).where(eq(parts.id, partId));
  if (!part || part.thumbnailRev === rev) return;
  await putObject(thumbKey(partId, rev), bytes, "image/png");
  const old = part.thumbnailRev;
  await db.transaction(async (tx) => {
    // Its fingerprint, for auto-link's "same picture" ("-" when the image can't be read).
    await tx.update(parts).set({ thumbnailRev: rev, thumbHash: imageHash(bytes) ?? "-" }).where(eq(parts.id, partId));
    // The first picture drawn here replaces one from Onshape (named by the part's Onshape
    // microversion, not "g…"). The part is the same state, so its drawing and its fab lock
    // move to the new name instead of all turning out of date at once.
    if (old && !REV.test(old)) {
      await tx.update(partDrawings).set({ rev }).where(and(eq(partDrawings.partId, partId), eq(partDrawings.rev, old)));
      if (part.releasedSnapshot?.thumbnailRev === old) {
        await tx
          .update(parts)
          .set({ releasedSnapshot: sql`jsonb_set(${parts.releasedSnapshot}, '{thumbnailRev}', to_jsonb(${rev}::text))` })
          .where(eq(parts.id, partId));
      }
    }
  });
  // The picture a released part was locked with stays for To Fab (plan/fab-version-lock.md).
  const locked = old && !REV.test(old) && part.releasedSnapshot?.thumbnailRev === old ? rev : part.releasedSnapshot?.thumbnailRev;
  if (old && old !== locked) await deleteObject(thumbKey(partId, old)).catch(() => {});
}
