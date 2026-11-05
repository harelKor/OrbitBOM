import Link from "next/link";
import { notFound } from "next/navigation";
import { CotsView } from "@/components/cots/CotsView";
import { MarkSeen } from "@/components/shell/Arrivals";
import { requireMember } from "@/lib/auth";
import { getSeenAt } from "@/lib/data/seen";
import { listCotsCarts } from "@/lib/data/cotsCarts";
import { listInventory } from "@/lib/data/inventory";
import { listCotsParts } from "@/lib/data/parts";

const LISTS = {
  released: { title: "Released", list: "released", text: "COTS parts whose design is released. Pick the ones to buy and send them to the order list." },
  "order-list": { title: "Order List", list: "order", text: "What to buy. Set each part's status as it's seen, on its way and in stock." },
} as const;

// The COTS page's two lists: Released and Order List.
export default async function CotsListPage({ params }: { params: Promise<{ list: string }> }) {
  const member = await requireMember();
  const { list } = await params;
  const page = LISTS[list as keyof typeof LISTS];
  if (!page) notFound();
  // The new parts glow: when this member last opened this list, from before this visit.
  const seenPage = page.list === "released" ? "cots:released" : "cots:order";
  // Released's search box looks through the shelf.
  const [{ robots, parts, categories }, inventory, carts, seenAt] = await Promise.all([
    listCotsParts(),
    page.list === "released" ? listInventory() : null,
    page.list === "order" ? listCotsCarts() : [],
    getSeenAt(member.id, seenPage),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <Link href="/cots" className="text-xs font-semibold tracking-wide text-subtle uppercase hover:text-fg">
          COTS
        </Link>
        <h1 className="display text-3xl text-accent">{page.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{page.text}</p>
      </div>
      <MarkSeen page={seenPage} />
      <CotsView
        list={page.list}
        seenAt={seenAt}
        parts={parts}
        robots={robots}
        categories={categories}
        carts={carts}
        shelf={inventory ? { items: inventory.items, categories: inventory.categories, locations: inventory.locations, conditions: inventory.conditions } : undefined}
      />
    </div>
  );
}
