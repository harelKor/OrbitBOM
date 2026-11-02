import { OrderHistoryView } from "@/components/cots/OrderHistoryView";
import { requireMember } from "@/lib/auth";
import { listOrderHistory } from "@/lib/data/inventory";

// The COTS Order History page: every order that went In Route or arrived, by vendor.
export default async function OrderHistoryPage() {
  await requireMember();
  return <OrderHistoryView cards={await listOrderHistory()} />;
}
