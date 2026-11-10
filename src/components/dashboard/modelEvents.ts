// Fired on window when the robot's 3D model no longer matches the BOM (a commit); an open
// RobotViewer rebuilds it from Onshape.
export const MODEL_STALE_EVENT = "orbit:model-stale";

// The event's detail: a listener sets `taken` and calls `resolve` once the model is rebuilt.
export type ModelStaleDetail = { resolve: () => void; taken: boolean };

// Fired on window by a double-click on a part in a 3D view: the card for that BOM part (on this
// page) opens its details window and sets `taken`. When no card took it, the viewer goes to the
// part's system page and leaves the id under OPEN_PART_PENDING, which the card opens on arrival.
export const OPEN_PART_EVENT = "orbit:open-part";
export type OpenPartDetail = { partId: string; taken: boolean };
export const OPEN_PART_PENDING = "orbit:open-part";

// Bulk edit and the 3D view on a system page (Harel, 2026-11-10): BomView fires BULK_SELECTION_EVENT
// with the selected part ids whenever they change (null when Bulk edit ends), and the viewer draws
// them in green; while it's on, a click on a part in the viewer fires BULK_TOGGLE_EVENT with its
// id, which adds it to or takes it out of the selection. A viewer that mounts later asks with
// BULK_ASK_EVENT, and BomView fires the selection again.
export const BULK_SELECTION_EVENT = "orbit:bulk-selection";
export type BulkSelectionDetail = { ids: string[] | null };
export const BULK_TOGGLE_EVENT = "orbit:bulk-toggle";
export type BulkToggleDetail = { partId: string };
export const BULK_ASK_EVENT = "orbit:bulk-ask";
