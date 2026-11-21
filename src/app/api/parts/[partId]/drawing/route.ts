import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { DENIED, hasCapability } from "@/lib/mode";
import { loadDrawing, makeDrawings } from "@/lib/drawing/make";
import { loadBody } from "@/lib/drawing/bodyStore";
import { unpackBody } from "@/lib/drawing/bodyPack";
import { extraViews as extraViews_, pictureKey } from "@/lib/drawing/extra";
import { imageUrl } from "@/lib/storage/r2";
import { OnshapeError } from "@/lib/onshape/client";
import { isUuid } from "@/lib/uuid";
import { z } from "zod";

// Fluid compute lets a Hobby function run up to 300 s; one part is one Part Studio, well inside it.
export const maxDuration = 300;

// A part's saved drawing with its BOM block filled from the part as it is now. The browser lays
// it out and turns it into PNG or PDF. A database read only: drawings are made by POST.
export async function GET(_: Request, { params }: { params: Promise<{ partId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { partId } = await params;
  if (!isUuid(partId)) return NextResponse.json({ error: "Unknown part." }, { status: 404 });
  const loaded = await loadDrawing(partId);
  if (!loaded) return NextResponse.json({ error: "This part has no drawing yet." }, { status: 404 });
  const { drawing, title, others, outdated } = loaded;
  // Added views: straight ones made from the kept geometry (one R2 read, only when there are
  // any), angled ones as their pictures' signed links. No Onshape calls.
  const extra = drawing.edits.extra ?? [];
  const [body, hrefs] = await Promise.all([
    extra.some((x) => !x.pic) ? loadBody(partId).catch(() => null) : null,
    Promise.all(extra.filter((x) => x.pic).map(async (x) => [x.key, await imageUrl(pictureKey(partId, x.key)).catch(() => null)] as const)),
  ]);
  const extraViews = extraViews_(body ? unpackBody(body) : null, extra, Object.fromEntries(hrefs));
  return NextResponse.json({ part: drawing.part, edits: drawing.edits, title, others, fitParts: await loaded.fitParts(), outdated, extraViews, rev: drawing.rev });
}

const Pt = z.tuple([z.number(), z.number()]);
const Ref = z.object({ v: z.string().max(20), p: Pt, hole: z.string().max(100).optional(), ang: z.number().optional() });
const Edits = z.object({
  hidden: z.array(z.string().max(100)).max(300).optional(),
  text: z.record(z.string().max(100), z.string().max(300)).optional(),
  moved: z.record(z.string().max(100), Pt).optional(),
  arrows: z.record(z.string().max(100), Pt).optional(),
  shift: z.record(z.string().max(100), Pt).optional(),
  tips: z.record(z.string().max(100), Ref).optional(),
  dims: z
    .array(z.object({ id: z.string().max(100), a: Ref, b: Ref, dir: z.enum(["h", "v", "a"]), off: z.number(), tx: z.number().optional(), text: z.string().max(100).optional() }))
    .max(100)
    .optional(),
  added: z
    .array(
      z.object({
        id: z.string().max(100),
        text: z.string().max(300),
        at: Pt,
        leader: Pt.optional(),
        ref: Ref.optional(),
        off: Pt.optional(),
        dia: z.boolean().optional(),
        fitPartId: z.string().uuid().optional(),
        fitInventoryItemId: z.string().uuid().optional(),
        fitTargetName: z.string().max(200).optional(),
      }),
    )
    .max(100)
    .optional(),
  extra: z
    .array(
      z.object({
        key: z.string().regex(/^add[a-z0-9]{1,16}$/),
        dir: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
        right: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
        pic: z.object({ w: z.number().positive().max(5000), h: z.number().positive().max(5000), rev: z.string().max(100).nullable().optional() }).optional(),
      }),
    )
    .max(20)
    .optional(),
  views: z
    .record(z.string().max(20), z.object({ cx: z.number().finite(), cy: z.number().finite(), s: z.number().positive().max(100), r: z.number().finite().optional() }))
    .optional(),
});

// Save the member's edits to the drawing's notes (the drawing editor).
export async function PUT(request: Request, { params }: { params: Promise<{ partId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await hasCapability("draw"))) return NextResponse.json({ error: DENIED.draw }, { status: 403 });
  const { partId } = await params;
  if (!isUuid(partId)) return NextResponse.json({ error: "Unknown part." }, { status: 404 });
  const edits = Edits.safeParse(await request.json().catch(() => null));
  if (!edits.success) return NextResponse.json({ error: "Those edits don't look right." }, { status: 400 });
  const saved = await db
    .update(schema.partDrawings)
    .set({ edits: edits.data, updatedBy: member.id, updatedAt: new Date() })
    .where(eq(schema.partDrawings.partId, partId))
    .returning({ partId: schema.partDrawings.partId });
  if (!saved.length) return NextResponse.json({ error: "This part has no drawing yet." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// Make this one part's drawing from Onshape: the part card's Drawing button when it has none yet,
// and the drawing editor's Regenerate (`force`, which remakes it even when it's current and keeps
// its edits).
export async function POST(request: Request, { params }: { params: Promise<{ partId: string }> }) {
  const started = Date.now();
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await hasCapability("draw"))) return NextResponse.json({ error: DENIED.draw }, { status: 403 });
  const { partId } = await params;
  if (!isUuid(partId)) return NextResponse.json({ error: "Unknown part." }, { status: 404 });
  const force = z.object({ force: z.boolean().optional() }).safeParse(await request.json().catch(() => ({}))).data?.force ?? false;
  if (!member.onshapeConnected) {
    return NextResponse.json({ error: "Connect your Onshape account first (Profile → Connect Onshape)." }, { status: 403 });
  }
  const [part] = await db.select({ systemId: schema.parts.systemId }).from(schema.parts).where(eq(schema.parts.id, partId));
  if (!part) return NextResponse.json({ error: "Unknown part." }, { status: 404 });
  if (!part.systemId) return NextResponse.json({ error: "Only parts in a system get drawings." }, { status: 422 });
  try {
    const summary = await makeDrawings(part.systemId, [partId], member.id, started + 240_000, force);
    const skipped = summary.skipped.find((s) => s.id === partId);
    if (skipped) return NextResponse.json({ error: `No drawing for this part: ${skipped.reason}.` }, { status: 422 });
    if (!summary.made.includes(partId)) return NextResponse.json({ error: "Onshape took too long. Try again." }, { status: 504 });
    revalidatePath("/robots", "layout");
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof OnshapeError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("Drawing failed", err);
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Drawing failed: ${reason.slice(0, 300)}` }, { status: 500 });
  }
}

// Delete the part's drawing (the drawing editor's Delete). The card's Drawing button can make it again.
export async function DELETE(_: Request, { params }: { params: Promise<{ partId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await hasCapability("draw"))) return NextResponse.json({ error: DENIED.draw }, { status: 403 });
  const { partId } = await params;
  if (!isUuid(partId)) return NextResponse.json({ error: "Unknown part." }, { status: 404 });
  await db.delete(schema.partDrawings).where(eq(schema.partDrawings.partId, partId));
  revalidatePath("/robots", "layout");
  return NextResponse.json({ ok: true });
}
