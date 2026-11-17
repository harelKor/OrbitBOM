import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { encodeMeshes } from "@/lib/model/mesh";
import { sandboxSheetMetal } from "@/lib/model/sandbox";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// The sandbox's sheet metal bracket for the part window's Open flatten (/dev/viewer?flat=1).
// ?model=folded|flat: the one-placement viewer model, like /api/parts/<id>/model and /flat;
// ?file=folded|flat: its mesh file, gzipped like the real ones in R2. Development only.
export function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const sp = new URL(request.url).searchParams;
  const file = sp.get("file");
  if (file === "folded" || file === "flat") {
    const body = new Uint8Array(gzipSync(encodeMeshes([sandboxSheetMetal(file)])));
    return new NextResponse(body, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
  }
  const shape = sp.get("model") === "flat" ? "flat" : "folded";
  const partId = shape === "flat" ? "SHEET_FLAT" : "SHEET";
  return NextResponse.json({ model: { studios: [`/api/dev/viewer/sheet?file=${shape}`], keys: [null], placements: [{ s: 0, k: `sandbox:sheet:${partId}`, t: IDENTITY }] } });
}
