import "server-only";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { MATERIALS, type MaterialList } from "@/config/materials";

const { materialGroups } = schema;

type Exec = Pick<typeof db, "select" | "insert">;

// The team's materials by category, in list order. The first read seeds them from
// config/materials.ts.
export async function listMaterials(exec: Exec = db): Promise<MaterialList> {
  const read = () => exec.select().from(materialGroups).orderBy(asc(materialGroups.position), asc(materialGroups.name));
  let rows = await read();
  if (!rows.length) {
    await exec
      .insert(materialGroups)
      .values(Object.entries(MATERIALS).map(([name, materials], position) => ({ name, materials, position })))
      .onConflictDoNothing();
    rows = await read();
  }
  return Object.fromEntries(rows.map((r) => [r.name, r.materials]));
}
