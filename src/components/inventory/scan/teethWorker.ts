import { countTeethInRing, type TeethResult } from "@/lib/recognize/teeth";

// Counts teeth in a background worker. If the worker can't start, fails to load or doesn't
// answer within a second, counting moves onto the page for good, so the scan never hangs
// (2026-11-12: a build that shipped the worker uncompiled left Capture on "Reading…").
const ANSWER_MS = 1000;

export function startTeethWorker() {
  let worker: Worker | null = null;
  try {
    // Built separately (src/lib/recognize/teeth.worker.ts → public/, `npm run worker`).
    worker = new Worker("/teeth-worker.js");
  } catch {
    worker = null;
  }
  let next = 0;
  const waiting = new Map<number, { resolve: (r: TeethResult | null) => void; rgba: Uint8ClampedArray; size: number; timer: number }>();
  const giveUp = () => {
    worker?.terminate();
    worker = null;
    for (const w of waiting.values()) {
      clearTimeout(w.timer);
      w.resolve(countTeethInRing(w.rgba, w.size));
    }
    waiting.clear();
  };
  if (worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; result: TeethResult | null }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      clearTimeout(w.timer);
      waiting.delete(e.data.id);
      w.resolve(e.data.result);
    };
    worker.onerror = giveUp;
    worker.onmessageerror = giveUp;
  }
  return {
    count(rgba: Uint8ClampedArray, size: number): Promise<TeethResult | null> {
      if (!worker) return Promise.resolve(countTeethInRing(rgba, size));
      const id = ++next;
      return new Promise((resolve) => {
        // A copy goes to the worker, so the page still has the pixels if it has to count itself.
        const copy = rgba.slice();
        waiting.set(id, { resolve, rgba, size, timer: window.setTimeout(giveUp, ANSWER_MS) });
        worker!.postMessage({ id, rgba: copy, size }, [copy.buffer]);
      });
    },
    stop() {
      worker?.terminate();
      worker = null;
      for (const w of waiting.values()) {
        clearTimeout(w.timer);
        w.resolve(null);
      }
      waiting.clear();
    },
  };
}
