import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isTeam, type Team } from "@/config/teams";
import type { Member } from "@/lib/auth";
import { isUuid } from "@/lib/uuid";

export type TeamSystem = { id: string; name: string; robotName: string };

// Systems of active robots, newest robot first, for the subsystem dropdowns.
export async function listTeamSystems(): Promise<TeamSystem[]> {
  return db
    .select({ id: schema.systems.id, name: schema.systems.name, robotName: schema.robots.name })
    .from(schema.systems)
    .innerJoin(schema.robots, eq(schema.robots.id, schema.systems.robotId))
    .where(eq(schema.robots.archived, false))
    .orderBy(desc(schema.robots.year), asc(schema.robots.name), asc(schema.systems.name));
}

// Sets a member's team. Only CAD Team keeps a subsystem; an unknown system id is dropped.
export async function saveTeam(memberId: string, team: Team | null, systemId: string | null) {
  if (team !== null && !isTeam(team)) throw new Error("Unknown team.");
  let system: string | null = null;
  if (team === "cad" && systemId && isUuid(systemId)) {
    const [row] = await db.select({ id: schema.systems.id }).from(schema.systems).where(eq(schema.systems.id, systemId)).limit(1);
    system = row?.id ?? null;
  }
  await db.update(schema.members).set({ team, systemId: system }).where(eq(schema.members.id, memberId));
}

// Where opening the app takes a member: Build Team to To Fab, CAD Team to their subsystem
// (or its robot's dashboard), everyone else stays on the home tiles (null).
export async function landingPath(member: Member, robotId: string | null): Promise<string | null> {
  if (member.team === "cad" && member.systemId) {
    const [system] = await db
      .select({ id: schema.systems.id, robotId: schema.systems.robotId })
      .from(schema.systems)
      .innerJoin(schema.robots, eq(schema.robots.id, schema.systems.robotId))
      .where(and(eq(schema.systems.id, member.systemId), eq(schema.robots.archived, false)))
      .limit(1);
    if (system) return `/robots/${system.robotId}/systems/${system.id}`;
  }
  if (!member.team || !robotId) return null;
  return member.team === "build" ? `/robots/${robotId}/fab` : `/robots/${robotId}`;
}
