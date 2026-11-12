// The teeth counter off the page's main thread, so the camera never stutters while it reads.
// Built on its own by esbuild into public/teeth-worker.js (`npm run worker`, run before every
// build and dev start): Turbopack shipped `new Worker(new URL(…))` as the raw .ts (2026-11-12).
import { countTeethInRing } from "./teeth";

addEventListener("message", (e: MessageEvent<{ id: number; rgba: Uint8ClampedArray; size: number }>) => {
  postMessage({ id: e.data.id, result: countTeethInRing(e.data.rgba, e.data.size) });
});
