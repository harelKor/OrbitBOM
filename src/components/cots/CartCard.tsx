"use client";

import { useTransition } from "react";
import { deleteCotsCart } from "@/app/(app)/cots/actions";
import { partTitle, type CardPart } from "@/components/bom/types";
import { BatchDate, collageGrid } from "@/components/fab/BatchCard";
import { useCan } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { cartKind } from "@/lib/cotsCart";
import type { CotsCart } from "@/lib/data/cotsCarts";

// An Order List cart, closed: a collage of its parts like a Shop Fab batch or a Factory pack, the
// day it was made, its vendor and the cart button, which opens the vendor's site with a cart of
// these parts (src/app/api/cots/carts). A click on the card opens it across the row with each
// part's own card and status, like a grouped card on this page.
export function CartCard({ cart, members, open, onToggle, children }: { cart: CotsCart; members: CardPart[]; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const work = useCan("work");
  const [pending, startTransition] = useTransition();
  const fillable = members.some((p) => cartKind(p.cotsLinks?.[0]?.url));
  const count = `${members.length} part${members.length === 1 ? "" : "s"}`;
  const thumbs = members.slice(0, 9);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const cartButton = fillable ? (
    <a
      href={`/api/cots/carts/${cart.id}`}
      target="_blank"
      rel="noreferrer"
      onClick={stop}
      title={`Open a ${cart.vendor} cart with these parts`}
      aria-label={`Open a ${cart.vendor} cart with ${count}`}
      className="press flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-amber-400 px-3.5 text-sm font-bold text-slate-950 shadow-md shadow-amber-400/30 hover:bg-amber-300 active:scale-[0.98]"
    >
      <Icon name="cart" className="h-5 w-5" />
      Cart
    </a>
  ) : (
    <span
      title={`${cart.vendor}'s site has no link that fills a cart: open each part's own link`}
      className="flex h-10 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-xl border border-line-strong px-3.5 text-sm font-bold text-subtle"
    >
      <Icon name="cart" className="h-5 w-5" />
      Cart
    </span>
  );

  if (open)
    return (
      <div style={{ gridColumn: "1 / -1" }} className="card-interactive flex flex-col ring-2 ring-amber-400/70 ring-offset-2 ring-offset-ink">
        <div role="button" tabIndex={0} onClick={onToggle} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onToggle()} aria-expanded className="press flex cursor-pointer flex-wrap items-center gap-3 p-3">
          <span className="grid h-14 w-14 shrink-0 gap-px overflow-hidden rounded-xl bg-white" style={collageGrid(Math.min(members.length, 4))}>
            {members.slice(0, 4).map((p) => (
              <Picture key={p.id} part={p} small />
            ))}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-fg">{cart.vendor}</span>
            <span className="flex items-center gap-2 text-xs text-subtle">
              <span className="font-mono tabular-nums">{count}</span>
              <BatchDate at={cart.createdAt} />
            </span>
          </span>
          {work && (
            <button
              type="button"
              disabled={pending}
              className="press text-xs text-subtle hover:text-rose-700"
              onClick={(e) => {
                stop(e);
                if (confirm(`Delete the ${cart.vendor} cart? Its parts stay on the Order List.`)) startTransition(() => void deleteCotsCart(cart.id));
              }}
            >
              Delete cart
            </button>
          )}
          {cartButton}
          <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-950">Close ⧉</span>
        </div>
        <div className="cursor-default border-t border-line p-3">{children}</div>
      </div>
    );

  return (
    <div onClick={onToggle} data-part={members.map((p) => p.id).join(" ")} className="card-interactive flex cursor-pointer flex-col self-start text-sm">
      <div className="relative w-full shrink-0">
        <button aria-expanded={false} aria-label={`Open the ${cart.vendor} cart`} className="thumb-well grid aspect-[4/3] w-full gap-px overflow-hidden" style={collageGrid(thumbs.length)}>
          {thumbs.map((p) => (
            <Picture key={p.id} part={p} single={thumbs.length === 1} />
          ))}
        </button>
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start gap-1.5">
          <BatchDate at={cart.createdAt} overlay />
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 p-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg">{cart.vendor}</span>
          <span className="font-mono text-xs text-subtle tabular-nums">{count}</span>
        </span>
        {cartButton}
      </div>
    </div>
  );
}

function Picture({ part, small = false, single = false }: { part: CardPart; small?: boolean; single?: boolean }) {
  const src = (!part.isManual && part.thumbUrl) || part.shelf?.thumbUrl || null;
  return (
    <span className={`flex min-h-0 min-w-0 items-center justify-center ${small ? "bg-white" : "bg-well"}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links
        <img src={src} alt="" loading="lazy" className={`h-full w-full object-contain ${small ? "p-0.5" : single ? "p-3" : "p-1.5"}`} />
      ) : small ? (
        <Icon name="box" className="h-4 w-4 text-slate-400" />
      ) : (
        <span className="px-1 text-center text-[10px] text-subtle">{partTitle(part)}</span>
      )}
    </span>
  );
}
