"use client";

import { useEffect, useState } from "react";
import { flattenMesh, type FlatGeom } from "@/lib/fab/layout";
import { decodeMeshes } from "@/lib/model/mesh";

export type Flat = Pick<FlatGeom, "w" | "h" | "outline" | "holes">;

// Flat outlines already worked out, kept while the tab is open (a mesh file never changes).
const cache = new Map<string, Flat | null>();

// The plate parts' real outlines (Harel, 2026-11-07: "their actual shape, not a rectangle"), from
// their saved 3D files, flattened here in the browser: the server only hands out links. Parts
// arrive file by file; until then (or with no saved shape) a part is drawn as its rectangle.
export function useFlatOutlines(robotId: string): Map<string, Flat> {
  const [flats, setFlats] = useState<Map<string, Flat>>(() => new Map());
  useEffect(() => {
    let stop = false;
    (async () => {
      const res = await fetch(`/api/robots/${robotId}/raw-stock-meshes`).catch(() => null);
      if (!res?.ok) return;
      const { meshes } = (await res.json()) as { meshes: { partId: string; url: string; onshapePartId: string }[] };
      const byFile = new Map<string, typeof meshes>();
      for (const m of meshes) byFile.set(m.url.split("?")[0], [...(byFile.get(m.url.split("?")[0]) ?? []), m]);
      const queue = [...byFile.values()];
      const worker = async () => {
        for (let list = queue.shift(); list && !stop; list = queue.shift()) {
          const key = (m: (typeof meshes)[number]) => `${m.url.split("?")[0]}|${m.onshapePartId}`;
          const todo = list.filter((m) => !cache.has(key(m)));
          if (todo.length) {
            try {
              const file = await fetch(list[0].url);
              if (!file.ok || !file.body) throw new Error(String(file.status));
              const buf = await new Response(file.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
              const bodies = new Map(decodeMeshes(buf).map((b) => [b.partId, b]));
              for (const m of todo) {
                if (stop) return;
                const body = bodies.get(m.onshapePartId);
                const g = body ? flattenMesh(body.positions, body.indices) : null;
                cache.set(key(m), g && g.outline.length > 2 ? { w: g.w, h: g.h, outline: g.outline, holes: g.holes } : null);
                // Let the page breathe between parts: a big plate's mesh takes a moment.
                await new Promise((r) => setTimeout(r, 0));
              }
            } catch {
              todo.forEach((m) => cache.set(key(m), null));
            }
          }
          if (stop) return;
          setFlats((prev) => {
            const next = new Map(prev);
            for (const m of list) {
              const f = cache.get(key(m));
              if (f) next.set(m.partId, f);
            }
            return next;
          });
        }
      };
      await Promise.all([worker(), worker()]);
    })();
    return () => {
      stop = true;
    };
  }, [robotId]);
  return flats;
}
