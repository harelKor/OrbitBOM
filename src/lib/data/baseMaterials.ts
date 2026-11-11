import "server-only";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { BASE_MATERIALS } from "@/config/materials";
import { cached } from "./cache";

const { baseMaterials } = schema;

type Exec = Pick<typeof db, "select" | "insert">;

// The team's base materials in their order. The first read seeds them from config/materials.ts.
export async function listBaseMaterials(exec: Exec = db): Promise<{ id: string; name: string }[]> {
  return exec === db ? cached("baseMaterials", ["base_materials"], () => loadBaseMaterials(db)) : loadBaseMaterials(exec);
}

async function loadBaseMaterials(exec: Exec): Promise<{ id: string; name: string }[]> {
  let rows = await exec.select({ id: baseMaterials.id, name: baseMaterials.name }).from(baseMaterials).orderBy(asc(baseMaterials.position), asc(baseMaterials.name));
  if (!rows.length) {
    await exec
      .insert(baseMaterials)
      .values(BASE_MATERIALS.map((name, position) => ({ name, position })))
      .onConflictDoNothing();
    rows = await exec.select({ id: baseMaterials.id, name: baseMaterials.name }).from(baseMaterials).orderBy(asc(baseMaterials.position), asc(baseMaterials.name));
  }
  return rows;
}
