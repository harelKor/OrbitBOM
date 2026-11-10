import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { encodeMeshes } from "@/lib/model/mesh";
import { sandboxStudio } from "@/lib/model/sandbox";

// The local 3D sandbox's one Part Studio file, gzipped like the real ones in R2 (the viewer
// unzips it itself, so no Content-Encoding). Development only.
export function GET() {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const body = new Uint8Array(gzipSync(encodeMeshes(sandboxStudio())));
  return new NextResponse(body, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
}
