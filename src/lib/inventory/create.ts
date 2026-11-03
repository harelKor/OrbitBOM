import "server-only";
import { db, schema } from "@/db";
import { recordItemChanges } from "./history";
import { setStock, type MoveCtx } from "./moves";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type NewItem = Omit<typeof schema.inventoryItems.$inferInsert, "id" | "inStock">;

// The one way an item is added (the item form, a spreadsheet import, a member's Claude): the
// row, its "created" line in the item's history (what AI log revert and Recently deleted rely
// on), and its starting count as a counted stock move. Callers run auto-link afterwards.
export async function createItem(tx: Tx, values: NewItem, inStock: number, ctx: MoveCtx): Promise<string> {
  const [{ id }] = await tx.insert(schema.inventoryItems).values(values).returning({ id: schema.inventoryItems.id });
  await recordItemChanges(tx, id, null, { name: values.name }, ctx);
  if (inStock) await setStock(tx, id, inStock, ctx);
  return id;
}
