import { countTeethInRing, type TeethResult } from "@/lib/recognize/teeth";

// Counts teeth in a background worker; where workers can't start, on the page instead.
export function startTeethWorker() {
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("./teeth.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  let next = 0;
  const waiting = new Map<number, (r: TeethResult | null) => void>();
  if (worker)
    worker.onmessage = (e: MessageEvent<{ id: number; result: TeethResult | null }>) => {
      waiting.get(e.data.id)?.(e.data.result);
      waiting.delete(e.data.id);
    };
  return {
    count(rgba: Uint8ClampedArray, size: number): Promise<TeethResult | null> {
      if (!worker) return Promise.resolve(countTeethInRing(rgba, size));
      const id = ++next;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        worker!.postMessage({ id, rgba, size }, [rgba.buffer]);
      });
    },
    stop() {
      worker?.terminate();
      for (const done of waiting.values()) done(null);
      waiting.clear();
    },
  };
}
