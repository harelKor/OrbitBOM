import "server-only";
import { z } from "zod";
import { MACHINES, isPrinter } from "@/config/machines";
import { COTS_STATUSES } from "@/config/cots";
import { FACTORY_STATUSES, PRINT_STATUSES, STATUSES } from "@/config/statuses";
import { listMaterialGroups } from "@/lib/data/materials";
import { read } from "../registry";

// The fixed lists Claude reads names from.

read("list_statuses", "member", "The part statuses, in board order, with which count as done. COTS parts use cots_statuses instead; parts made at a factory_fab machine (list_machines) use only factory_statuses, and parts on a team_printer only print_statuses (Gcoded and In Process 1 are shown there as Sliced and Printing).", z.object({}), async () => ({
  statuses: STATUSES.map((s) => ({ name: s.name, done: "done" in s && !!s.done })),
  cots_statuses: COTS_STATUSES.map((s) => s.name),
  factory_statuses: FACTORY_STATUSES,
  print_statuses: PRINT_STATUSES,
}));
read("list_machines", "member", "The team's machines with their stage and the CAD file each needs.", z.object({}), async () =>
  MACHINES.map((m) => ({ id: m.id, name: m.name, stage: m.stage, cad_format: m.cadFormat, factory_fab: "factoryFab" in m && m.factoryFab, team_printer: isPrinter(m.id) })),
);
read(
  "list_materials",
  "member",
  "A part's material is an inventory item. These are the Raw Stock items (plates, tubes, shaft stock, filament) by inventory category, with their stock. Pass an item's id to set_up_parts as material_item_id. Other inventory items can be materials too: find them with search_inventory.",
  z.object({}),
  async () =>
    (await listMaterialGroups())
      .filter((g) => g.raw)
      .map((g) => ({ category: g.id, label: g.label, items: g.items.map((i) => ({ id: i.id, name: i.name, label: i.label, in_stock: i.stock })) })),
);
