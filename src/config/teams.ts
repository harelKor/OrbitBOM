export const TEAMS = [
  { id: "build", label: "Build Team", text: "Opens on Shop Fab" },
  { id: "cad", label: "CAD Team", text: "Opens on your subsystem" },
] as const;
export type Team = (typeof TEAMS)[number]["id"];

export function isTeam(value: unknown): value is Team {
  return TEAMS.some((t) => t.id === value);
}
