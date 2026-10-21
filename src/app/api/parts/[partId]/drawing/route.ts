import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { loadDrawing } from "@/lib/drawing/make";
import { isUuid } from "@/lib/uuid";
import { z } from "zod";

// A part's saved drawing with its BOM block filled from the part as it is now. The browser lays
// it out and turns it into PNG or PDF. A database read only: drawings are made from the system
// page.
export async function GET(_: Request, { params }: { params: Promise<{ partId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { partId } = await params;
  if (!isUuid(partId)) return NextResponse.json({ error: "Unknown part." }, { status: 404 });
  const loaded = await loadDrawing(partId);
  if (!loaded) return NextResponse.json({ error: "This part has no drawing yet." }, { status: 404 });
  const { drawing, title, others, outdated } = loaded;
  return NextResponse.json({ part: drawing.part, edits: drawing.edits, title, others, outdated });
}

const Pt = z.tuple([z.number(), z.number()]);
const Edits = z.object({
  hidden: z.array(z.string().max(100)).max(200).optional(),
  text: z.record(z.string().max(100), z.string().max(300)).optional(),
  moved: z.record(z.string().max(100), Pt).optional(),
  arrows: z.record(z.string().max(100), Pt).optional(),
  added: z.array(z.object({ id: z.string().max(100), text: z.string().max(300), at: Pt, leader: Pt.optional() })).max(100).optional(),
});

// Save the member's edits to the drawing's notes (the drawing editor).
export async function PUT(request: Request, { params }: { params: Promise<{ partId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
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
