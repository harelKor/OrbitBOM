import Link from "next/link";
import { COTS_IN_STOCK, COTS_RELEASED, ORDER_STATUSES } from "@/config/cots";
import { Icon, type IconName } from "@/components/ui/Icon";
import { requireMember } from "@/lib/auth";
import { countCotsStatuses } from "@/lib/data/parts";

// The COTS page: two big boxes, Released and Order List.
export default async function CotsPage() {
  await requireMember();
  const counts = await countCotsStatuses();
  const ordering = ORDER_STATUSES.filter((s) => s !== COTS_IN_STOCK).reduce((n, s) => n + (counts.get(s) ?? 0), 0);
  const boxes = [
    { href: "/cots/released", title: "Released", count: counts.get(COTS_RELEASED) ?? 0, text: "Ready to be ordered", icon: "list" as IconName },
    { href: "/cots/order-list", title: "Order List", count: ordering, text: `Being ordered · ${counts.get(COTS_IN_STOCK) ?? 0} in stock`, icon: "cart" as IconName },
  ];
  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">Shop</div>
        <h1 className="display text-3xl text-accent">COTS</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">The parts the team buys, from released to on the shelf.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {boxes.map((b) => (
          <Link
            key={b.href}
            href={b.href}
            className="card-interactive group relative flex min-h-64 flex-col justify-between p-7 active:scale-[0.98] sm:min-h-80 sm:p-9"
          >
            <span className="absolute top-6 right-6 grid h-14 w-14 place-items-center rounded-2xl border border-line bg-raised text-accent transition-colors group-hover:border-accent/40 sm:top-8 sm:right-8 sm:h-16 sm:w-16">
              <Icon name={b.icon} className="h-8 w-8 sm:h-9 sm:w-9" />
            </span>
            <span className="display font-mono text-7xl text-accent tabular-nums sm:text-8xl">{b.count}</span>
            <span className="flex items-end gap-3">
              <span className="flex-1">
                <span className="block display text-4xl text-fg sm:text-5xl">{b.title}</span>
                <span className="mt-1 block text-base text-muted sm:text-lg">{b.text}</span>
              </span>
              <Icon name="arrow" className="h-7 w-7 text-subtle transition-transform group-hover:translate-x-1 group-hover:text-accent" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
