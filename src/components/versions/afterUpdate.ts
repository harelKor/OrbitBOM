import { MODEL_STALE_EVENT, type ModelStaleDetail } from "@/components/dashboard/modelEvents";

type ThumbRound = { fetched: number; pending: number; calls: number; failed?: number; error?: string } | { error: string };
type Router = { refresh: () => void };

export const PARTS_UPDATING_EVENT = "orbit:parts-updating"; // detail: true while loading, false when done

// After parts change from Onshape (a commit, a Revert, an Outdated part's Update, a check that
// took same parts in a newer version). The server action already returned the new BOM; here the
// new thumbnails are fetched while the 3D model rebuilds (RobotViewer listens and reloads its own
// model), and the page refreshes once, when new thumbnails are in. No page reload. Runs outside
// any transition.
export function afterPartsUpdate(systemId: string, router: Router) {
  setTimeout(async () => {
    window.dispatchEvent(new CustomEvent(PARTS_UPDATING_EVENT, { detail: true }));
    const model = new Promise<void>((resolve) => {
      const detail: ModelStaleDetail = { resolve, taken: false };
      window.dispatchEvent(new CustomEvent(MODEL_STALE_EVENT, { detail }));
      if (!detail.taken) resolve();
    });
    const thumbnails = (async () => {
      let fetched = 0;
      for (let round = 0; round < 10; round++) {
        const res = await fetch(`/api/systems/${systemId}/thumbnails`, { method: "POST" }).catch(() => null);
        const r = ((await res?.json().catch(() => null)) ?? { error: "Thumbnails stopped." }) as ThumbRound;
        if ("error" in r && !("fetched" in r)) break;
        const t = r as Exclude<ThumbRound, { error: string }>;
        fetched += t.fetched;
        if (!t.pending || !t.fetched) break;
      }
      // The model can take minutes; the thumbnails don't wait for it.
      if (fetched) router.refresh();
    })();
    await Promise.all([model, thumbnails]);
    window.dispatchEvent(new CustomEvent(PARTS_UPDATING_EVENT, { detail: false }));
  });
}
