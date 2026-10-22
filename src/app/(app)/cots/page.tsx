import Link from "next/link";
import { COTS_IN_STOCK, COTS_RELEASED, ORDER_STATUSES } from "@/config/cots";
import { Icon } from "@/components/ui/Icon";
import { requireMember } from "@/lib/auth";
import { countCotsStatuses } from "@/lib/data/parts";

// The COTS page: two big boxes, Released and Order List.
export default async function CotsPage() {
  await requireMember();
  const counts = await countCotsStatuses();
  const ordering = ORDER_STATUSES.filter((s) => s !== COTS_IN_STOCK).reduce((n, s) => n + (counts.get(s) ?? 0), 0);
  const boxes = [
    { href: "/cots/released", title: "Released", count: counts.get(COTS_RELEASED) ?? 0, text: "Ready to be ordered" },
    { href: "/cots/order-list", title: "Order List", count: ordering, text: `Being ordered · ${counts.get(COTS_IN_STOCK) ?? 0} in stock` },
  ];
  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">Shop</div>
        <h1 className="display text-3xl text-accent">COTS</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">The parts the team buys, from released to on the shelf.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {boxes.map((b) => (
          <Link key={b.href} href={b.href} className="card-interactive group flex min-h-48 flex-col justify-between p-6">
            <span className="display font-mono text-6xl text-accent tabular-nums">{b.count}</span>
            <span className="flex items-end gap-2">
              <span className="flex-1">
                <span className="block display text-3xl text-fg">{b.title}</span>
                <span className="text-sm text-muted">{b.text}</span>
              </span>
              <Icon name="arrow" className="h-6 w-6 text-subtle transition-transform group-hover:translate-x-1 group-hover:text-accent" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
