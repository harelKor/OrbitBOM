"use client";

import { useTransition } from "react";
import { deleteCotsCart } from "@/app/(app)/cots/actions";
import type { CardPart } from "@/components/bom/types";
import { BatchCard } from "@/components/fab/BatchCard";
import type { FabLayout } from "@/components/fab/fabModel";
import { Icon } from "@/components/ui/Icon";
import { cartKind } from "@/lib/cotsCart";
import type { CotsCart } from "@/lib/data/cotsCarts";
import type { PartChanges } from "@/lib/parts/changes";

// An Order List cart: a Factory pack's card (the same collage, date, and strip that opens under its
// row, Harel 2026-11-04) named by its vendor, with the cart button, which opens the vendor's site
// with a cart of these parts (src/app/api/cots/carts).
export function CartCard({
  cart,
  members,
  save,
  card,
  onRemove,
  layout = "cards",
}: {
  cart: CotsCart;
  members: CardPart[];
  save: (ids: string[], changes: PartChanges) => void;
  card: (p: CardPart) => React.ReactNode;
  onRemove: (partIds: string[]) => void;
  layout?: FabLayout;
}) {
  const [, startTransition] = useTransition();
  const fillable = members.some((p) => cartKind(p.cotsLinks?.[0]?.url));
  const count = `${members.length} part${members.length === 1 ? "" : "s"}`;
  const button = fillable ? (
    <a
      href={`/api/cots/carts/${cart.id}`}
      target="_blank"
      rel="noreferrer"
      title={`Open a ${cart.vendor} cart with these parts`}
      aria-label={`Open a ${cart.vendor} cart with ${count}`}
      className="press flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-amber-400 px-3 text-sm font-bold text-slate-950 shadow-md shadow-amber-400/30 hover:bg-amber-300 active:scale-[0.98]"
    >
      <Icon name="cart" className="h-4.5 w-4.5" />
      Cart
    </a>
  ) : (
    <span
      title={`${cart.vendor}'s site has no link that fills a cart: open each part's own link`}
      className="flex h-9 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm font-bold text-subtle"
    >
      <Icon name="cart" className="h-4.5 w-4.5" />
      Cart
    </span>
  );
  // The collage shows the parts' own pictures, or their shelf item's.
  const pictured = members.map((p) => ({ ...p, thumbUrl: (!p.isManual && p.thumbUrl) || p.shelf?.thumbUrl || null }));
  return (
    <BatchCard
      pack
      title={cart.vendor}
      batch={{ id: cart.id, name: cart.vendor, machine: null, madeBy: null, priority: "normal", gcode: null, createdAt: cart.createdAt }}
      members={pictured}
      save={save}
      card={(p) => card(members.find((m) => m.id === p.id) ?? p)}
      layout={layout}
      draggable={false}
      memberNames={[]}
      me=""
      cart={{ button, onDelete: () => startTransition(() => void deleteCotsCart(cart.id)), onRemove: (id) => onRemove([id]) }}
    />
  );
}
