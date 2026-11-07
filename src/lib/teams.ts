import "server-only";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isTeam, type Team } from "@/config/teams";
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
