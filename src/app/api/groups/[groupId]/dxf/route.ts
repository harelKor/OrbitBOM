import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { PlateDxfError, plateDxf, plateDxfName } from "@/lib/drawing/plateDxf";
import { NeedsOnshapeError } from "@/lib/model/part";
import { OnshapeError } from "@/lib/onshape/client";
import { isUuid } from "@/lib/uuid";
import { zip } from "@/lib/zip";

export const maxDuration = 60;

// A Fab batch's flat DXFs in one zip, each named with its quantity ("<name>_qty2.dxf"). Each
// plate's DXF is stored per revision (src/lib/drawing/plateDxf.ts), so this mostly reads R2.
// Parts that aren't plates are listed in skipped.txt. When time runs out, what's made so far is
// stored and the browser is told to try again.
export async function GET(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const deadline = Date.now() + 50_000;
  const member = await getMember();
  if (!member) return new NextResponse("Sign in first.", { status: 401 });
  const { groupId } = await params;
  if (!isUuid(groupId)) return new NextResponse("Unknown batch.", { status: 400 });

  const [group] = await db.select({ name: schema.partGroups.name }).from(schema.partGroups).where(eq(schema.partGroups.id, groupId));
  if (!group) return new NextResponse("Unknown batch.", { status: 404 });
  const rows = await db
    .select({ part: schema.parts, assemblyUrl: schema.systems.assemblyUrl, robotId: schema.systems.robotId })
    .from(schema.groupMembers)
    .innerJoin(schema.parts, eq(schema.parts.id, schema.groupMembers.partId))
    .innerJoin(schema.systems, eq(schema.systems.id, schema.parts.systemId))
    .where(eq(schema.groupMembers.groupId, groupId));
  if (!rows.length) return new NextResponse("This batch has no parts.", { status: 400 });

  const files: [string, string][] = [];
  const skipped: string[] = [];
  let unfinished = 0;
  const queue = [...rows];
  const worker = async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const label = row.part.displayName ?? row.part.onshapeName ?? "part";
      if (Date.now() > deadline) {
        unfinished++;
        continue;
      }
      try {
        files.push([plateDxfName(row.part, row.part.quantity), await plateDxf(row, member, true, deadline)]);
      } catch (err) {
        if (err instanceof NeedsOnshapeError) throw err;
        if (err instanceof PlateDxfError || err instanceof OnshapeError) skipped.push(`${label}: ${err.message}`);
        else throw err;
      }
    }
  };
  try {
    await Promise.all([worker(), worker(), worker()]);
  } catch (err) {
    if (err instanceof NeedsOnshapeError) return new NextResponse(err.message, { status: 403 });
    throw err;
  }
  if (unfinished) return new NextResponse(`Still making ${unfinished} of ${rows.length} DXFs. Download again in a moment.`, { status: 503 });
  if (!files.length) return new NextResponse(`No plates in this batch have a flat DXF.\n${skipped.join("\n")}`, { status: 400 });

  // Same names never overwrite each other in the zip.
  const seen = new Map<string, number>();
  const named = files.map(([name, text]): [string, string] => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return [n > 1 ? name.replace(/\.dxf$/, ` (${n}).dxf`) : name, text];
  });
  if (skipped.length) named.push(["skipped.txt", `Not in this zip (not flat plates):\r\n${skipped.join("\r\n")}\r\n`]);
  const filename = `${group.name.replace(/[^\w.\- ]+/g, "_")} DXF.zip`;
  return new NextResponse(zip(named) as BodyInit, {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${filename}"` },
  });
}
