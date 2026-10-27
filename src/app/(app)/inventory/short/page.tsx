import { redirect } from "next/navigation";

// Short for robots is a toggle on the Inventory page now (Harel, 2026-10-27); old links land there.
export default function InventoryShortPage() {
  redirect("/inventory?view=robots");
}
