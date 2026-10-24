import Link from "next/link";
import { notFound } from "next/navigation";
import { CotsView } from "@/components/cots/CotsView";
import { requireMember } from "@/lib/auth";
import { listInventory } from "@/lib/data/inventory";
import { listCotsParts } from "@/lib/data/parts";

const LISTS = {
  released: { title: "Released", list: "released", text: "COTS parts whose design is released. Pick the ones to buy and send them to the order list." },
  "order-list": { title: "Order List", list: "order", text: "What to buy. Set each part's status as it's seen, on its way and in stock." },
} as const;

// The COTS page's two lists: Released and Order List.
export default async function CotsListPage({ params }: { params: Promise<{ list: string }> }) {
  await requireMember();
  const { list } = await params;
  const page = LISTS[list as keyof typeof LISTS];
  if (!page) notFound();
  // Released's search box looks through the shelf.
  const [{ robots, parts }, inventory] = await Promise.all([listCotsParts(), page.list === "released" ? listInventory() : null]);
  return (
    <div className="space-y-5">
      <div>
        <Link href="/cots" className="text-xs font-semibold tracking-wide text-subtle uppercase hover:text-fg">
          COTS
        </Link>
        <h1 className="display text-3xl text-accent">{page.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{page.text}</p>
      </div>
      <CotsView
        list={page.list}
        parts={parts}
        robots={robots}
        shelf={inventory ? { items: inventory.items, categories: inventory.categories, locations: inventory.locations, conditions: inventory.conditions } : undefined}
      />
    </div>
  );
}
