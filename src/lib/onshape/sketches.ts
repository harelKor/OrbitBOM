import "server-only";
import type { GeometrySketch } from "@/db/schema";
import { sketchFromAnswers, type SketchFile } from "@/lib/model/sketch";
import type { OnshapeClient } from "./client";

// A Part Studio's sketches, for the Onshape panel's Geometry choice (1 call): each sketch feature's
// id and name, in the feature list's order. Older and newer answers put the feature under
// `message` or not.
type FeatureAnswer = { features?: ({ featureType?: string; btType?: string; featureId?: string; name?: string; suppressed?: boolean } & { message?: { featureType?: string; featureId?: string; name?: string } })[] };
export async function listSketches(client: OnshapeClient, path: string): Promise<GeometrySketch[]> {
  const r = await client.json<FeatureAnswer>(`partstudios/${path}/features?noSketchGeometry=true&includeGeometryIds=false`);
  return (r.features ?? []).flatMap((raw) => {
    const f = raw.message ?? raw;
    const sketch = f.featureType === "newSketch" || (raw.btType ?? "").startsWith("BTMSketch");
    return sketch && f.featureId ? [{ id: f.featureId, name: f.name ?? "Sketch" }] : [];
  });
}

// The chosen sketches' lines, arcs and points in the Part Studio's frame: 1 call for their info
// (construction entities, and each sketch's plane should the points come in 2D) and 1 per sketch
// for its entities. A sketch deleted in Onshape since it was chosen is left out.
export async function fetchSketches(client: OnshapeClient, path: string, chosen: GeometrySketch[]): Promise<SketchFile> {
  if (!chosen.length) return { v: 1, sketches: [] };
  const ids = chosen.map((s) => `sketchId=${encodeURIComponent(s.id)}`).join("&");
  const info = await client.json<Parameters<typeof sketchFromAnswers>[3]>(`partstudios/${path}/sketches?${ids}&includeGeometry=true&output3D=true`).catch(() => undefined);
  const sketches = await Promise.all(
    chosen.map(async (s) => {
      try {
        const tess = await client.json<Parameters<typeof sketchFromAnswers>[2]>(`partstudios/${path}/sketches/${encodeURIComponent(s.id)}/tessellatedentities`);
        return sketchFromAnswers(s.id, s.name, tess, info);
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    }),
  );
  return { v: 1, sketches: sketches.filter((s) => s !== null) };
}
