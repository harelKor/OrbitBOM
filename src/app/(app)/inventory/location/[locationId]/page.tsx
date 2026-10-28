import { redirect } from "next/navigation";

// Locations filter in place now (?loc= on any Inventory page); old links land on the filtered home.
export default async function InventoryLocationPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params;
  redirect(`/inventory?loc=${encodeURIComponent(locationId)}`);
}
