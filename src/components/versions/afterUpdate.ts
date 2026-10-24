import { MODEL_STALE_EVENT } from "@/components/dashboard/modelEvents";

type ThumbRound = { fetched: number; pending: number; calls: number; failed?: number; error?: string } | { error: string };
type Router = { refresh: () => void };

// After parts change from Onshape (a commit, an Outdated part's Update, a check that took same
// parts in a newer version): the robot's 3D model rebuilds (RobotViewer listens) and the new
// thumbnails are fetched in rounds, the page re-rendering as they come. Runs outside any
// transition, so the updated BOM shows at once.
export function afterPartsUpdate(systemId: string, router: Router) {
  setTimeout(async () => {
    window.dispatchEvent(new Event(MODEL_STALE_EVENT));
    for (let round = 0; round < 10; round++) {
      const res = await fetch(`/api/systems/${systemId}/thumbnails`, { method: "POST" }).catch(() => null);
      const r = ((await res?.json().catch(() => null)) ?? { error: "Thumbnails stopped." }) as ThumbRound;
      if ("error" in r && !("fetched" in r)) break;
      const t = r as Exclude<ThumbRound, { error: string }>;
      if (t.fetched) router.refresh();
      if (!t.pending || !t.fetched) break;
    }
    router.refresh();
  });
}
