import "server-only";
import { inventoryPicker, loadItemHistory, materialPopup } from "@/app/(app)/inventory/actions";
import { loadPartWindow } from "@/app/(app)/parts-actions";
import { partReviewState } from "@/app/(app)/robots/[robotId]/review/actions";

// Reads that windows make while they open, served by GET /api/reads/<name> (src/lib/reads.ts).
// Each is its server action, with its own sign-in and capability checks.
export const READS = { inventoryPicker, loadItemHistory, materialPopup, loadPartWindow, partReviewState };
