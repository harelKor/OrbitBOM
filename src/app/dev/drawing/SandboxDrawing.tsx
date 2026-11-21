"use client";

import { useState } from "react";
import { DrawingEditor } from "@/components/drawing/DrawingEditor";
import type { ViewerModel } from "@/components/dashboard/ModelCanvas";
import type { DrawingEdits } from "@/db/schema";
import type { Body } from "@/lib/drawing/brep";
import { type PackedBody, unpackBody } from "@/lib/drawing/bodyPack";
import { extraViews } from "@/lib/drawing/extra";
import type { Part } from "@/lib/drawing/read";
import { encodeMeshes } from "@/lib/model/mesh";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// Add view's 3D model here: the part's bounding box as its mesh (the test parts have no mesh
// file), in a gzipped file of the viewer's format. Enough to try straight and angled views.
async function boxModel(body: Body): Promise<ViewerModel> {
  const pts = body.edges.flat();
  const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])) / 1000);
  const hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])) / 1000);
  const corner = (i: number) => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
  const positions = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7].flatMap(corner));
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  const indices = new Uint32Array(quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]));
  const raw = encodeMeshes([{ partId: body.id, positions, indices }]);
  const gz = await new Response(new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
  return { studios: [URL.createObjectURL(gz)], placements: [{ s: 0, k: `sandbox:${body.id}`, t: IDENTITY }] };
}

// Pick a test part, open its drawing in the real editor. Saves (and added views' pictures) are
// kept in this tab only.
export function SandboxDrawing({ parts }: { parts: { key: string; part: Part; body: PackedBody }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, DrawingEdits>>({});
  const [pictures, setPictures] = useState<Record<string, string>>({});
  const pick = parts.find((p) => p.key === open);
  return (
    <main className="space-y-3 p-6">
      <h1 className="text-lg font-semibold">Drawing editor sandbox</h1>
      <div className="flex flex-wrap gap-2">
        {parts.map((p) => (
          <button key={p.key} className="btn" onClick={() => setOpen(p.key)}>
            {p.key}
          </button>
        ))}
      </div>
      {pick && (
        <DrawingEditor
          partId={pick.key}
          onClose={() => setOpen(null)}
          load={async () => ({
            part: pick.part,
            edits: saved[pick.key] ?? {},
            title: { name: `1690-26-421-01 Test ${pick.key}`, material: "6061 Aluminum", processes: ["Router", "Tap"], quantity: 2, system: "Intake", robot: "R26", revision: "V12", date: "2026-11-17" },
            outdated: false,
            others: [],
            fitParts: [],
            extraViews: extraViews(unpackBody(pick.body), saved[pick.key]?.extra, pictures),
            rev: "sandbox",
          })}
          store={async (edits) => setSaved((s) => ({ ...s, [pick.key]: edits }))}
          loadBody={async () => unpackBody(pick.body)}
          loadModel={() => boxModel(unpackBody(pick.body))}
          savePicture={async (_, key, blob) => {
            const href = URL.createObjectURL(blob);
            setPictures((p) => ({ ...p, [key]: href }));
            return href;
          }}
        />
      )}
    </main>
  );
}
