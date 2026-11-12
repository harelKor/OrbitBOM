// The teeth counter off the page's main thread, so the camera never stutters while it reads.
import { countTeethInRing } from "@/lib/recognize/teeth";

addEventListener("message", (e: MessageEvent<{ id: number; rgba: Uint8ClampedArray; size: number }>) => {
  postMessage({ id: e.data.id, result: countTeethInRing(e.data.rgba, e.data.size) });
});
