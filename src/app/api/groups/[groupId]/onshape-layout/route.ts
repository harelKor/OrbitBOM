import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { batchLayout } from "@/lib/fab/batchLayout";
import type { Placement } from "@/lib/fab/layout";
import { pushOnshapeLayout } from "@/lib/fab/onshapeLayout";
import { requireCapability } from "@/lib/mode";
import { onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { isUuid } from "@/lib/uuid";

export const maxDuration = 60;

const body = z.object({
  placements: z
    .array(
      z.object({
        partId: z.string().uuid(),
        copy: z.number().int().min(0),
        x: z.number().finite(),
        y: z.number().finite(),
        rotation: z.number().finite(), // degrees about Z
      }),
    )
    .max(500)
    .optional(),
});

// Onshape Layout: build (or rebuild) the batch's "Batch - <name>" assembly in Onshape with every
// copy flat at its nested place. Without placements, the batch's automatic layout is used.
export async function POST(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const member = await requireCapability("work").catch(() => null);
  if (!member) return new NextResponse("Ask an admin to put you on a team (Build or CAD) to make changes.", { status: 403 });
  if (!member.onshapeConnected) return new NextResponse("Connect your Onshape account first (Profile → Connect Onshape).", { status: 403 });
  const { groupId } = await params;
  if (!isUuid(groupId)) return new NextResponse("Unknown batch.", { status: 400 });
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return new NextResponse("Bad layout.", { status: 400 });

  let placements = parsed.data.placements;
  if (!placements) placements = (await batchLayout(groupId, undefined, undefined, member))?.layout.placements ?? [];
  if (!placements.length) return new NextResponse("No part of this batch has a 3D model to lay out yet.", { status: 400 });

  // The Onshape host (cad.onshape.com or the Enterprise domain) from one of the batch's systems.
  const [host] = await db
    .select({ url: schema.systems.assemblyUrl })
    .from(schema.groupMembers)
    .innerJoin(schema.parts, eq(schema.parts.id, schema.groupMembers.partId))
    .innerJoin(schema.systems, eq(schema.systems.id, schema.parts.systemId))
    .where(eq(schema.groupMembers.groupId, groupId))
    .limit(1);
  const baseUrl = (host?.url && parseOnshapeUrl(host.url)?.baseUrl) || "https://cad.onshape.com";
  try {
    const result = await pushOnshapeLayout(onshapeClient(member.id, baseUrl), groupId, placements as Placement[]);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof OnshapeError) return new NextResponse(err.message, { status: 502 });
    throw err;
  }
}
