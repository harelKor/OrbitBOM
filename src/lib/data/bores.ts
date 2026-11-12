import "server-only";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { BORES } from "@/config/inventory";
import { cached } from "./cache";

const { bores } = schema;

type Exec = Pick<typeof db, "select" | "insert">;

// The team's global Bore list in its order (Settings → Bores). The first read seeds it from
// config/inventory.ts.
export async function listBores(exec: Exec = db): Promise<{ id: string; name: string }[]> {
  return exec === db ? cached("bores", ["bores"], () => loadBores(db)) : loadBores(exec);
}

async function loadBores(exec: Exec): Promise<{ id: string; name: string }[]> {
  const read = () => exec.select({ id: bores.id, name: bores.name }).from(bores).orderBy(asc(bores.position), asc(bores.name));
  let rows = await read();
  if (!rows.length) {
    await exec
      .insert(bores)
      .values(BORES.map((name, position) => ({ name, position })))
      .onConflictDoNothing();
    rows = await read();
  }
  return rows;
}
