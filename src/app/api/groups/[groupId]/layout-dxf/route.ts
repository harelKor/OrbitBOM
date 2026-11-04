import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { writeDxf } from "@/lib/drawing/dxf";
import { batchLayout } from "@/lib/fab/batchLayout";
import { DEFAULT_GAP, DEFAULT_MARGIN, sheetLoops } from "@/lib/fab/layout";
import { isUuid } from "@/lib/uuid";

export const maxDuration = 60;

// A laser batch's whole sheet as one 1:1 DXF (2026-11-04): every copy's outline and holes where
// Auto Layout put it, on the face chosen there (sheet metal: its flat pattern). The layout last
// saved in the window when it holds every copy, else Auto Layout's own nest. Reads the meshes
// already in R2: Onshape is called only for a flat pattern not fetched yet.
export async function GET(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const member = await getMember();
  if (!member) return new NextResponse("Sign in first.", { status: 401 });
  const { groupId } = await params;
  if (!isUuid(groupId)) return new NextResponse("Unknown batch.", { status: 400 });
  const [group] = await db.select({ machine: schema.partGroups.machine, saved: schema.partGroups.layoutData }).from(schema.partGroups).where(eq(schema.partGroups.id, groupId));
  if (!group) return new NextResponse("Unknown batch.", { status: 404 });
  if (group.machine !== "laser") return new NextResponse("A layout DXF is for laser batches.", { status: 400 });
  const layout = await batchLayout(groupId, group.saved?.gap ?? DEFAULT_GAP, group.saved?.margin ?? DEFAULT_MARGIN, member);
  if (!layout) return new NextResponse("Unknown batch.", { status: 404 });
  if (!layout.parts.length) return new NextResponse("No part in this batch has a saved 3D shape yet. Open Auto Layout to see why.", { status: 400 });

  const copies = new Set(layout.parts.flatMap((p) => Array.from({ length: p.quantity }, (_, copy) => `${p.partId}#${copy}`)));
  const saved = group.saved?.placements ?? [];
  const whole = saved.length === copies.size && saved.every((p) => copies.has(`${p.partId}#${p.copy}`));
  const placements = whole ? saved : layout.layout.placements;
  const left = copies.size - placements.length;
  if (left > 0) return new NextResponse(`${left} cop${left === 1 ? "y doesn't" : "ies don't"} fit on the sheet. Open Auto Layout and pick a bigger sheet first.`, { status: 409 });

  const text = writeDxf(sheetLoops(new Map(layout.parts.map((p) => [p.partId, p])), placements));
  const filename = `${layout.name.replace(/[^\w.\- ]+/g, "_")} layout.dxf`;
  return new NextResponse(text, { headers: { "content-type": "image/vnd.dxf", "content-disposition": `attachment; filename="${filename}"` } });
}
