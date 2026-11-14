import { and, eq, isNull } from "drizzle-orm";
import { deflateRawSync } from "node:zlib";
import { NextResponse } from "next/server";
import { getMachine } from "@/config/machines";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { OnshapeError } from "@/lib/onshape/client";
import { isExportFormat, type ExportFormat } from "@/lib/onshape/export";
import { PartFileError, partFileBytes } from "@/lib/onshape/partFile";
import { isUuid } from "@/lib/uuid";
import { zip } from "@/lib/zip";
import { contentDisposition } from "@/lib/http/disposition";

export const maxDuration = 60;

// A Factory Fab pack's parts in one compressed zip, each in its factory's format (Parasolid for
// Zivudim and Beth El, STL for ARAN and PCBway) and named with its quantity ("<name>_qty2.x_t").
// Exports are cached in R2 per part revision, so mostly this reads R2. Parts Onshape can't export
// are listed in skipped.txt; when time runs out, what's exported so far is stored and the browser
// is told to try again.
export async function GET(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const deadline = Date.now() + 50_000;
  const member = await getMember();
  if (!member) return new NextResponse("Sign in first.", { status: 401 });
  const { groupId } = await params;
  if (!isUuid(groupId)) return new NextResponse("Unknown pack.", { status: 400 });

  const [group] = await db.select({ name: schema.partGroups.name, machine: schema.partGroups.machine }).from(schema.partGroups).where(eq(schema.partGroups.id, groupId));
  if (!group) return new NextResponse("Unknown pack.", { status: 404 });
  const rows = await db
    .select({ part: schema.parts, assemblyUrl: schema.systems.assemblyUrl, robotId: schema.systems.robotId })
    .from(schema.groupMembers)
    .innerJoin(schema.parts, eq(schema.parts.id, schema.groupMembers.partId))
    .innerJoin(schema.systems, eq(schema.systems.id, schema.parts.systemId))
    .where(and(eq(schema.groupMembers.groupId, groupId), isNull(schema.parts.removedFromCadAt)));
  if (!rows.length) return new NextResponse("This pack has no parts.", { status: 400 });

  // The factory's format; a sheet metal part goes as its flat pattern where the factory takes one.
  const machine = group.machine ? getMachine(group.machine) : undefined;
  const formatOf = (row: (typeof rows)[number]): ExportFormat => {
    if (machine?.sheetFormat && row.part.geometry?.sheetMetal) return machine.sheetFormat;
    const f = machine?.cadFormat;
    return f && f !== "DXF" && isExportFormat(f) ? f : "STEP";
  };

  const files: [string, Uint8Array][] = [];
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
        const file = await partFileBytes(row, formatOf(row), true, member, deadline);
        const qty = row.part.quantity;
        files.push([qty > 1 ? file.filename.replace(new RegExp(`\\.${file.ext}$`), `_qty${qty}.${file.ext}`) : file.filename, file.bytes]);
      } catch (err) {
        if (err instanceof PartFileError && err.status === 403) throw err;
        if (err instanceof PartFileError || err instanceof OnshapeError) skipped.push(`${label}: ${err.message}`);
        else throw err;
      }
    }
  };
  try {
    await Promise.all([worker(), worker(), worker()]);
  } catch (err) {
    if (err instanceof PartFileError) return new NextResponse(err.message, { status: err.status });
    throw err;
  }
  if (unfinished) return new NextResponse(`Still exporting ${unfinished} of ${rows.length} parts. Download again in a moment.`, { status: 503 });
  if (!files.length) return new NextResponse(`No part in this pack could be exported.\n${skipped.join("\n")}`, { status: 400 });

  // Same names never overwrite each other in the zip.
  const seen = new Map<string, number>();
  const named = files.map(([name, bytes]): [string, string | Uint8Array] => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return [n > 1 ? name.replace(/(\.[^.]+)$/, ` (${n})$1`) : name, bytes];
  });
  if (skipped.length) named.push(["skipped.txt", `Not in this zip:\r\n${skipped.join("\r\n")}\r\n`]);
  // The pack is named after its factory and day ("Zivudim 04/11").
  const filename = `${group.name.replace(/[^\w.\- ]+/g, "_")}.zip`;
  return new NextResponse(zip(named, (data) => deflateRawSync(data)) as BodyInit, {
    headers: { "content-type": "application/zip", "content-disposition": contentDisposition(filename) },
  });
}
