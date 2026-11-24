// The Robots panel's folders (Harel, 2026-11-24). A robot in none sits at the top. "Old" robots
// are left out of every picker and background job, as archived robots used to be.
export const ROBOT_FOLDERS = [
  { key: "rebuilt", label: "ReBuilt" },
  { key: "practice", label: "Practice" },
  { key: "old", label: "Old" },
] as const;

export type RobotFolder = (typeof ROBOT_FOLDERS)[number]["key"];

export const isRobotFolder = (v: unknown): v is RobotFolder => ROBOT_FOLDERS.some((f) => f.key === v);
