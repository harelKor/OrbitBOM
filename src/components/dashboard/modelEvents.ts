// Fired on window when the robot's 3D model no longer matches the BOM (a commit); an open
// RobotViewer rebuilds it from Onshape.
export const MODEL_STALE_EVENT = "orbit:model-stale";

// The event's detail: a listener sets `taken` and calls `resolve` once the model is rebuilt.
export type ModelStaleDetail = { resolve: () => void; taken: boolean };
