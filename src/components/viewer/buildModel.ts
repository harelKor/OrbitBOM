// Rebuilds a robot's 3D model from the browser: one build step per request (POST
// /api/robots/<id>/model) until it's done, then the pictures that changed are drawn from it
// (pictures.ts). Used by the robot viewer's Update 3D model and by the Onshape panel's Update
// BOM / Update CAD (Harel, 2026-11-11).
import { drawPictures } from "./pictures";

export type BuildAnswer =
  | { state: "done"; unchanged: boolean; parts: number; calls: number }
  | { state: "working"; done: number; total: number; calls: number }
  | { error: string };

export type BuildOutcome = { ok: true; unchanged: boolean; parts: number; calls: number } | { ok: false; error: string; calls: number };

// `kind`: the robot's Final model (as before), its Basepart model (Harel, 2026-11-12) or its BOM
// model. The Final brings the BOM model after it (Harel, 2026-11-18): each system at its BOM
// version, sharing the Final's plans and files where they're on the same state.
export async function buildModel(robotId: string, onProgress?: (text: string) => void, kind: "final" | "basepart" | "bom" = "final"): Promise<BuildOutcome> {
  const out = await buildOne(robotId, onProgress, kind);
  if (kind !== "final" || !out.ok) return out;
  const bom = await buildOne(robotId, onProgress, "bom");
  return bom.ok ? { ...out, calls: out.calls + bom.calls } : { ...bom, calls: out.calls + bom.calls };
}

async function buildOne(robotId: string, onProgress: ((text: string) => void) | undefined, kind: "final" | "basepart" | "bom"): Promise<BuildOutcome> {
  let calls = 0;
  try {
    for (let round = 0; round < 30; round++) {
      const res = await fetch(`/api/robots/${robotId}/model${kind === "final" ? "" : `?model=${kind}`}`, { method: "POST" });
      const a = (await res.json().catch(() => ({ error: `The export failed (${res.status}).` }))) as BuildAnswer;
      if ("error" in a) return { ok: false, error: a.error, calls };
      calls += a.calls;
      if (a.state === "working") {
        onProgress?.(`Exporting part studios ${a.done}/${a.total}…`);
        continue;
      }
      return { ok: true, unchanged: a.unchanged, parts: a.parts, calls };
    }
    return { ok: false, error: "Onshape is still exporting. Press Update again to continue.", calls };
  } catch {
    return { ok: false, error: "The export stopped. Press Update again to continue.", calls };
  }
}

// The model, then its pictures. `systemId`: only that system's pictures (the robot's own picture
// waits for the robot page, which has every file).
export async function buildModelAndPictures(robotId: string, systemId: string | undefined, onProgress?: (text: string) => void): Promise<BuildOutcome & { pictures?: number }> {
  const built = await buildModel(robotId, onProgress);
  if (!built.ok) return built;
  onProgress?.("Drawing the pictures…");
  const pictures = await drawPictures(robotId, systemId, (done, total) => onProgress?.(`Drawing the pictures ${done}/${total}…`));
  return { ...built, pictures };
}
