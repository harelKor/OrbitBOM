import { MODEL_STALE_EVENT, type ModelStaleDetail } from "@/components/dashboard/modelEvents";
import { buildModelAndPictures } from "@/components/viewer/buildModel";

type Router = { refresh: () => void };

export const PARTS_UPDATING_EVENT = "orbit:parts-updating"; // detail: true while loading, false when done

// After parts change from Onshape (a commit, a Revert, an Outdated part's Update, a check that
// took same parts in a newer version). The server action already returned the new BOM; here each
// Part Studio's sheet metal and body types are read for the export files (a Part Studio read
// before at the same revision costs nothing), and, when the member ticked "Update 3D views"
// (`rebuild`: the robot), the 3D model rebuilds and its pictures are drawn: by the page's viewer
// when it has one (RobotViewer listens), else here. Without it the 3D views stay where they were,
// which saves the export's calls (Harel, 2026-11-11). The page refreshes once at the end. Runs
// outside any transition.
export function afterPartsUpdate(systemId: string, router: Router, { rebuild }: { rebuild?: string } = {}) {
  setTimeout(async () => {
    window.dispatchEvent(new CustomEvent(PARTS_UPDATING_EVENT, { detail: true }));
    const partData = fetch(`/api/systems/${systemId}/part-data`, { method: "POST" }).catch(() => null);
    const model = !rebuild
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const detail: ModelStaleDetail = { resolve, taken: false };
          window.dispatchEvent(new CustomEvent(MODEL_STALE_EVENT, { detail }));
          if (!detail.taken) void buildModelAndPictures(rebuild, systemId).finally(resolve);
        });
    await Promise.all([partData, model]);
    router.refresh();
    window.dispatchEvent(new CustomEvent(PARTS_UPDATING_EVENT, { detail: false }));
  });
}
