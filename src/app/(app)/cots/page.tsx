import Link from "next/link";
import { COTS_IN_STOCK, COTS_RELEASED, ORDER_STATUSES } from "@/config/cots";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ArrivalMark } from "@/components/shell/Arrivals";
import { requireMember } from "@/lib/auth";
import { countOrderHistory } from "@/lib/data/inventory";
import { countCotsStatuses } from "@/lib/data/parts";

// The COTS page: two big boxes, Released and Order List, and a long Order History box below them.
export default async function CotsPage() {
  await requireMember();
  const [counts, history] = await Promise.all([countCotsStatuses(), countOrderHistory()]);
  const ordering = ORDER_STATUSES.filter((s) => s !== COTS_IN_STOCK).reduce((n, s) => n + (counts.get(s) ?? 0), 0);
  const boxes = [
    { href: "/cots/released", page: "cots:released", title: "Released", count: counts.get(COTS_RELEASED) ?? 0, text: "Ready to be ordered", icon: "list" as IconName },
    { href: "/cots/order-list", page: "cots:order", title: "Order List", count: ordering, text: `Being ordered · ${counts.get(COTS_IN_STOCK) ?? 0} in stock`, icon: "cart" as IconName },
  ];
  return (
    <div className="flex min-h-[calc(100dvh-var(--topbar-h,2.75rem)-2rem)] flex-col gap-5 pb-4 md:min-h-[calc(100dvh-var(--topbar-h,2.75rem)-3rem)]">
      <div>
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">Shop</div>
        <h1 className="display text-3xl text-accent">Orders</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">The parts the team buys, from released to on the shelf.</p>
      </div>
      <div className="grid flex-1 grid-rows-[3fr_3fr_2fr] gap-3 sm:grid-cols-2 sm:grid-rows-[3fr_1fr] sm:gap-5">
        {boxes.map((b) => (
          // Glows while the list has parts this member hasn't seen (src/lib/seen.ts).
          <ArrivalMark key={b.href} page={b.page}>
          <Link
            key={b.href}
            href={b.href}
            className="card-interactive group relative flex min-h-40 flex-col justify-between p-5 active:scale-[0.98] sm:min-h-80 sm:p-9"
          >
            <span className="absolute top-4 right-4 grid h-11 w-11 place-items-center rounded-2xl border border-line bg-raised text-accent transition-colors group-hover:border-accent/40 sm:top-8 sm:right-8 sm:h-16 sm:w-16">
              <Icon name={b.icon} className="h-6 w-6 sm:h-9 sm:w-9" />
            </span>
            <span className="display font-mono text-5xl text-accent tabular-nums sm:text-8xl">{b.count}</span>
            <span className="flex items-end gap-3">
              <span className="flex-1">
                <span className="block display text-3xl text-fg sm:text-5xl">{b.title}</span>
                <span className="mt-0.5 block text-sm text-muted sm:text-lg">{b.text}</span>
              </span>
              <Icon name="arrow" className="h-7 w-7 text-subtle transition-transform group-hover:translate-x-1 group-hover:text-accent" />
            </span>
          </Link>
          </ArrivalMark>
        ))}
        <Link
          href="/cots/history"
          className="card-interactive group relative col-span-full flex min-h-20 items-center gap-4 p-4 active:scale-[0.98] sm:min-h-36 sm:gap-7 sm:p-6"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-line bg-raised text-accent transition-colors group-hover:border-accent/40 sm:h-14 sm:w-14">
            <Icon name="clock" className="h-5 w-5 sm:h-8 sm:w-8" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block display text-xl text-fg sm:text-4xl">Order History</span>
            <span className="mt-0.5 block text-xs text-muted sm:text-base">Every order, from In Route to arrived</span>
          </span>
          <span className="display font-mono text-3xl text-accent tabular-nums sm:text-6xl">{history}</span>
          <Icon name="arrow" className="h-7 w-7 shrink-0 text-subtle transition-transform group-hover:translate-x-1 group-hover:text-accent" />
        </Link>
      </div>
    </div>
  );
}
