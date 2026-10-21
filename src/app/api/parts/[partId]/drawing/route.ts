import { and, eq, isNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getMachine } from "@/config/machines";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
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
  const [row] = await db
    .select({ drawing: schema.partDrawings, part: schema.parts, system: schema.systems.name, robot: schema.robots.name })
    .from(schema.partDrawings)
    .innerJoin(schema.parts, eq(schema.parts.id, schema.partDrawings.partId))
    .innerJoin(schema.systems, eq(schema.systems.id, schema.parts.systemId))
    .innerJoin(schema.robots, eq(schema.robots.id, schema.systems.robotId))
    .where(eq(schema.partDrawings.partId, partId));
  if (!row) return NextResponse.json({ error: "This part has no drawing yet." }, { status: 404 });
  const { part, drawing } = row;
  const processes = [part.preProcess, part.process1, part.process2, ...part.extraProcesses]
    .filter((p): p is string => !!p)
    .map((p) => getMachine(p)?.name ?? p);
  // The system's other parts, for "fit for <part>" notes in the editor.
  const others = await db
    .select({ displayName: schema.parts.displayName, onshapeName: schema.parts.onshapeName })
    .from(schema.parts)
    .where(and(eq(schema.parts.systemId, part.systemId), ne(schema.parts.id, part.id), isNull(schema.parts.removedFromCadAt)));
  return NextResponse.json({
    part: drawing.part,
    others: [...new Set(others.map((o) => o.displayName ?? o.onshapeName).filter((n): n is string => !!n))].sort(),
    edits: drawing.edits,
    outdated: !!part.thumbnailRev && drawing.rev !== part.thumbnailRev,
    title: {
      name: part.displayName ?? part.onshapeName ?? "Unnamed part",
      ...(part.material ? { material: part.material } : {}),
      processes,
      quantity: part.quantity,
      system: row.system,
      robot: row.robot,
      ...(drawing.rev ? { revision: drawing.rev.slice(0, 8) } : {}),
      date: drawing.updatedAt.toISOString().slice(0, 10),
    },
  });
}

const Pt = z.tuple([z.number(), z.number()]);
const Edits = z.object({
  hidden: z.array(z.string().max(100)).max(200).optional(),
  text: z.record(z.string().max(100), z.string().max(300)).optional(),
  moved: z.record(z.string().max(100), Pt).optional(),
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
