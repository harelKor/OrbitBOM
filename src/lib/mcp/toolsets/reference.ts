import "server-only";
import { z } from "zod";
import { MACHINES } from "@/config/machines";
import { COTS_STATUSES } from "@/config/cots";
import { STATUSES } from "@/config/statuses";
import { listMaterialGroups } from "@/lib/data/materials";
import { read } from "../registry";

// The fixed lists Claude reads names from.

read("list_statuses", "The part statuses, in board order, with which count as done. COTS parts use cots_statuses instead.", z.object({}), async () => ({
  statuses: STATUSES.map((s) => ({ name: s.name, done: "done" in s && !!s.done })),
  cots_statuses: COTS_STATUSES.map((s) => s.name),
}));
read("list_machines", "The team's machines with their stage and the CAD file each needs.", z.object({}), async () =>
  MACHINES.map((m) => ({ id: m.id, name: m.name, stage: m.stage, cad_format: m.cadFormat })),
);
read(
  "list_materials",
  "A part's material is an inventory item. These are the Raw Stock items (plates, tubes, shaft stock, filament) by inventory category, with their stock. Pass an item's id to set_up_parts as material_item_id. Other inventory items can be materials too: find them with search_inventory.",
  z.object({}),
  async () =>
    (await listMaterialGroups())
      .filter((g) => g.raw)
      .map((g) => ({ category: g.id, label: g.label, items: g.items.map((i) => ({ id: i.id, name: i.name, label: i.label, in_stock: i.stock })) })),
);
