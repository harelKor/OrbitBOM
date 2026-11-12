import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import type { SketchFile } from "@/lib/model/sketch";

// The local 3D sandbox's Geometry sketches (Harel, 2026-11-12), gzipped JSON like the real ones in
// R2: a 1 m × 0.6 m frame outline on the floor with a construction diagonal, a 50 mm hole circle
// and a point, and a standing sketch with an arc. Development only.
export function GET() {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const circle = (cx: number, cy: number, r: number, from = 0, to = 2 * Math.PI, n = 48) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = from + ((to - from) * i) / n;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a), 0];
    });
  const flat = (pts: number[][]) => pts.flat();
  const file: SketchFile = {
    v: 1,
    sketches: [
      {
        id: "Fframe",
        name: "Frame geometry",
        entities: [
          { p: flat([[-0.5, -0.3, 0], [0.5, -0.3, 0]]) },
          { p: flat([[0.5, -0.3, 0], [0.5, 0.3, 0]]) },
          { p: flat([[0.5, 0.3, 0], [-0.5, 0.3, 0]]) },
          { p: flat([[-0.5, 0.3, 0], [-0.5, -0.3, 0]]) },
          { p: flat([[-0.5, -0.3, 0], [0.5, 0.3, 0]]), c: true },
          { p: flat(circle(0.2, 0, 0.025).slice(0, -1)), closed: true },
        ],
        points: [0, 0, 0],
      },
      {
        id: "Farm",
        name: "Arm geometry",
        entities: [
          { p: flat([[0, 0, 0], [0.4, 0, 0]].map(([x, , z]) => [x, 0, z + 0.3])) },
          { p: flat(circle(0, 0, 0.4, 0, Math.PI / 2).map(([x, y]) => [x, 0, y + 0.3])) },
        ],
        points: [],
      },
    ],
  };
  return new NextResponse(new Uint8Array(gzipSync(JSON.stringify(file))), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
}
