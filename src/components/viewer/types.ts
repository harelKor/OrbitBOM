// Shared types of the 3D viewer (src/components/viewer/). Each module defines its own tools type
// next to its code; SceneTools is their sum, so a session adding a tool edits only its own module.
// The public names are re-exported from ModelCanvas.tsx, where the pages import them.
import type * as THREE from "three";
import type { Appearance } from "@/lib/model/mesh";
import type { Joint, Relation } from "@/lib/model/mates";
import type { CameraTools } from "./camera";
import type { CheckTools } from "./checkScene";
import type { OverlapTools } from "./redOverlap";
import type { PartTools } from "./load";
import type { MeasureTools } from "./measureLayer";
import type { MotionTools } from "./motion";
import type { DisplayTools } from "./paint";
import type { PinTools } from "./pins";
import type { AnchorTools } from "./anchors";
import type { SectionTools } from "./section";
import type { StageTools } from "./stage";
import type { VisibilityTools } from "./visibility";

export type ViewerModel = {
  studios: (string | null)[];
  // Each studio file's R2 key (it names one Part Studio revision, so the file never changes): the
  // browser keeps the file under it and skips the download next time (meshCache.ts). Null or
  // missing for a file that can change under its name; that one is always downloaded.
  keys?: (string | null)[];
  placements: { s: number; k: string; t: number[]; g?: number; b?: number }[]; // b: rigid body (mates.ts)
  joints?: (Joint & { g?: number })[]; // moving mates between bodies (plan/cad-mates.md)
  relations?: Relation[];
  fixed?: number[]; // bodies holding a part fixed in Onshape: each mechanism's base
  groups?: { systemIds: string[]; name: string }[]; // subsystems, by placement g
  // A Basepart's Geometry sketch files (src/lib/model/sketch.ts), where they sit (row-major, like
  // placements), their subsystem group (none: the robot's own) and whose they are (Harel,
  // 2026-11-12). `sketchesHidden`: drawn only after Shift+H (the Final model).
  sketches?: { url: string | null; key: string; t: number[]; g?: number; owner: string }[];
  sketchesHidden?: boolean;
};

// status: parts in their BOM status colours; cad: as Onshape draws them; tint: Onshape's look with
// a light wash of the status colour (the BOM pages' 3D views, Harel 2026-11-13).
export type ViewerMode = "status" | "cad" | "tint";

// One instanced mesh per (subsystem, Part Studio, part): `keys[i]` is the BOM key of copy i, `g`
// its subsystem group, `look` Onshape's appearance from the file.
// A Geometry sketch is one too (sketches.ts): one copy, no faces, its lines and points as
// children, `sketch` its name; its points are already where it sits, so its copy is at identity.
// `bodies[i]`: copy i's rigid body (-1: none), for moving along the mates.
export type PartMesh = { mesh: THREE.InstancedMesh; keys: string[]; g: number; look?: Appearance; sketch?: { name: string }; bodies?: number[] };

// A part instance hidden with Y: its mesh, its index there, and its BOM key.
export type Gone = { m: number; i: number; key: string };

// The parts hidden with Y or Hide, for a page that lists them itself (CAD folds the list under its
// Tools on phones, Harel 2026-11-09).
export type HiddenParts = { items: { id: string; name: string }[]; show: (id: string | null) => void };

// CAD Review's viewer tools (plan/design-review.md): standard views, a section plane, measuring
// between two points on the meshes (≈: the export's chord tolerance), hiding or isolating a part.
export type SceneTools = CameraTools & SectionTools & MeasureTools & VisibilityTools & PartTools & StageTools & DisplayTools & MotionTools & PinTools & AnchorTools & CheckTools & OverlapTools & { whenLoaded: () => Promise<void>; selectGroup: (c: { m: number; i: number }) => void; pickedCopies: () => { m: number; i: number }[] };
