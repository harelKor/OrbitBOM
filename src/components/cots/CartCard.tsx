"use client";

import { useTransition } from "react";
import { BEFORE_IN_ROUTE, COTS_IN_ROUTE, ORDER_STATUSES } from "@/config/cots";
import { deleteCotsCart } from "@/app/(app)/cots/actions";
import type { CardPart } from "@/components/bom/types";
import { BatchCard } from "@/components/fab/BatchCard";
import type { FabLayout } from "@/components/fab/fabModel";
import { useCan, useMode } from "@/components/shell/ModeContext";
import { statusDenied } from "@/components/shell/mode";
import { Icon } from "@/components/ui/Icon";
import { copyListText } from "@/lib/cots";
import { cartKind } from "@/lib/cotsCart";
import { toast } from "@/components/ui/Toaster";
import { safeAction } from "@/lib/safeAction";
import type { CotsCart } from "@/lib/data/cotsCarts";
import type { PartChanges } from "@/lib/parts/changes";
import { cotsLinkDenied } from "@/lib/parts/cotsLink";
import { orderStatus } from "@/lib/status";
import { OrderStatusButton } from "./CotsCard";
import { useOverdue } from "./overdue";

// A cart's name: the one its member gave it (parts with no product link), else its vendor.
export const cartTitle = (cart: Pick<CotsCart, "name" | "vendor">) => cart.name ?? (cart.vendor || "Cart");

// An order line as Copy list writes it: its name with its stock size, and how many to order.
export type CartLine = { name: string; amount: number };

// An Order List cart: a Factory pack's card (the same collage, date, and strip that opens under its
// row, Harel 2026-11-04) named by its vendor, with the cart button, which opens the vendor's site
// with a cart of these parts (src/app/api/cots/carts). A cart of parts with no product link carries
// its member-given name and Copy list instead (Harel, 2026-11-24).
export function CartCard({
  cart,
  members,
  save,
  card,
  onRemove,
  lineOf,
  layout = "cards",
}: {
  cart: CotsCart;
  members: CardPart[];
  save: (ids: string[], changes: PartChanges) => void;
  card: (p: CardPart) => React.ReactNode;
  onRemove: (partIds: string[]) => void;
  lineOf: (p: CardPart) => CartLine;
  layout?: FabLayout;
}) {
  const title = cartTitle(cart);
  const [, startTransition] = useTransition();
  const work = useCan("work");
  const { mode } = useMode();
  const ids = members.map((p) => p.id);
  // The least advanced part, for the delivery pill.
  const order = (p: CardPart) => (ORDER_STATUSES as readonly string[]).indexOf(orderStatus(p));
  const lowest = members.reduce((a, p) => (order(p) < order(a) ? p : a), members[0]);
  const status = <CartStatus cart={cart} members={members} save={save} compact={layout === "list"} />;
  const dates = [...new Set(members.map((p) => p.cotsDeliveryDate).filter((d): d is string => !!d))];
  const delivery = (
    <DeliveryPill
      value={dates.length === 1 ? dates[0] : null}
      status={orderStatus(lowest)}
      mixed={dates.length > 1}
      editable={work}
      onChange={(date) => {
        // Setting a date moves the parts not yet on their way to In Route (those the status rules
        // let move: the date saves either way).
        const moving =
          date && !statusDenied(mode, COTS_IN_ROUTE, { cots: true })
            ? members.filter((p) => (BEFORE_IN_ROUTE as string[]).includes(orderStatus(p)) && !cotsLinkDenied(p, { status: COTS_IN_ROUTE })).map((p) => p.id)
            : [];
        const rest = ids.filter((id) => !moving.includes(id));
        if (moving.length) save(moving, { cotsDeliveryDate: date, status: COTS_IN_ROUTE });
        if (rest.length) save(rest, { cotsDeliveryDate: date });
      }}
    />
  );
  const button = <CartButton cart={cart} members={members} lineOf={lineOf} />;
  // The collage shows the parts' own pictures, or their shelf item's.
  const pictured = members.map((p) => ({ ...p, thumbUrl: (!p.isManual && p.thumbUrl) || p.shelf?.thumbUrl || null }));
  return (
    <BatchCard
      pack
      title={title}
      batch={{ id: cart.id, name: title, machine: null, madeBy: null, priority: "normal", gcode: null, createdAt: cart.createdAt }}
      members={pictured}
      save={save}
      card={(p) => card(members.find((m) => m.id === p.id) ?? p)}
      layout={layout}
      draggable={false}
      memberNames={[]}
      me=""
      cart={{ button, status, delivery, onDelete: () => startTransition(async () => { const r = await safeAction(() => deleteCotsCart(cart.id)); if (r.error) toast(r.error, true); }), onRemove: (id) => onRemove([id]) }}
    />
  );
}

// One status for the whole cart, shown as its least advanced part's; a pick sets every part.
export function CartStatus({ cart, members, save, compact = false }: { cart: CotsCart; members: CardPart[]; save: (ids: string[], changes: PartChanges) => void; compact?: boolean }) {
  const order = (p: CardPart) => (ORDER_STATUSES as readonly string[]).indexOf(orderStatus(p));
  const lowest = members.reduce((a, p) => (order(p) < order(a) ? p : a), members[0]);
  return <OrderStatusButton part={{ ...lowest, displayName: `the ${cartTitle(cart)} cart` }} save={(changes) => save(members.map((p) => p.id), changes)} compact={compact} />;
}

// The cart's button: a vendor's cart opens its site with the parts in its cart; a cart of parts
// with no product link copies them as a plain list for WhatsApp or email.
export function CartButton({ cart, members, lineOf }: { cart: CotsCart; members: CardPart[]; lineOf: (p: CardPart) => CartLine }) {
  const count = `${members.length} part${members.length === 1 ? "" : "s"}`;
  if (!cart.vendor) {
    const copy = async () => {
      const lines = members.map(lineOf);
      const buying = lines.filter((l) => l.amount > 0);
      const text = copyListText(cartTitle(cart), buying.length ? buying : lines.map((l) => ({ ...l, amount: Math.max(l.amount, 1) })));
      try {
        await navigator.clipboard.writeText(text);
        toast("Copied: paste the list into WhatsApp or an email");
      } catch {
        toast("This browser didn't let the list be copied.", true);
      }
    };
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void copy();
        }}
        title="Copy the parts and how many as a plain list"
        aria-label={`Copy ${cartTitle(cart)}'s list of ${count}`}
        className="press flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-amber-400 px-3 text-sm font-bold whitespace-nowrap text-slate-950 shadow-md shadow-amber-400/30 hover:bg-amber-300 active:scale-[0.98]"
      >
        <Icon name="note" className="h-4.5 w-4.5" />
        Copy list
      </button>
    );
  }
  const fillable = members.some((p) => cartKind(p.cotsLinks?.[0]?.url));
  return fillable ? (
    <a
      href={`/api/cots/carts/${cart.id}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
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
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-11-12" as "Nov 12": a plain date, the same on the server and in every browser.
export const deliveryDay = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;

// The cart's delivery date on its pictures' top left, on a frosted pill like the day it was made.
// A tap opens the browser's date picker; clearing it there takes the date off.
function DeliveryPill({ value, status, mixed, editable, onChange }: { value: string | null; status: string; mixed: boolean; editable: boolean; onChange: (date: string | null) => void }) {
  const late = useOverdue(value, status);
  if (!editable && !value) return null;
  const label = value ? deliveryDay(value) : mixed ? "Mixed dates" : "Delivery date";
  return (
    <span
      title={late ? "Delivery date: passed and the order isn't here yet" : value ? "Delivery date" : "Set the delivery date"}
      className={`relative flex items-center gap-1 rounded-full border bg-surface/90 px-2 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap tabular-nums shadow-sm backdrop-blur-md ${
        late ? "border-rose-400/70 text-rose-600 dark:text-rose-300" : value ? "border-emerald-400/60 text-emerald-600 dark:text-emerald-300" : "border-dashed border-line-strong text-muted"
      } ${editable ? "press cursor-pointer hover:border-accent" : ""}`}
    >
      <Icon name="truck" className="h-3.5 w-3.5" />
      {label}
      {editable && (
        <input
          type="date"
          value={value ?? ""}
          aria-label="Delivery date"
          onClick={(e) => e.currentTarget.showPicker?.()}
          onChange={(e) => onChange(e.target.value || null)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      )}
    </span>
  );
}
