import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { BEFORE_IN_ROUTE } from "@/config/cots";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { orderAmount } from "@/lib/cots";
import { cartKind, cartUrl, linkVariant, type CartLine } from "@/lib/cotsCart";
import { shelfOfParts } from "@/lib/data/inventory";
import { shopifyVariantId } from "@/lib/inventory/product";
import { orderStatus } from "@/lib/status";
import { isUuid } from "@/lib/uuid";

export const maxDuration = 30;

// Still to buy: the cart's parts not yet bought (In Order List, Seen). In Route ones were ordered
// already, so a cart pressed again after new parts joined it doesn't buy them twice (ORD-12);
// all the cart's parts go in only when none is left to buy.
const BUYING = new Set<string>(BEFORE_IN_ROUTE);

// A cart's cart button: sends the browser to the vendor's cart with the cart's parts in it, each
// as many as are still to order (orderAmount: typed on the Order List, else worked out).
// A Shopify link with no ?variant= has its product's .json read for the variant; those reads run
// side by side (the store's own servers, not Onshape).
export async function GET(_request: Request, { params }: { params: Promise<{ cartId: string }> }) {
  const member = await getMember();
  if (!member) return new NextResponse("Sign in first.", { status: 401 });
  const { cartId } = await params;
  if (!isUuid(cartId)) return new NextResponse("Unknown cart.", { status: 400 });
  const [cart] = await db.select().from(schema.cotsCarts).where(eq(schema.cotsCarts.id, cartId));
  if (!cart) return new NextResponse("That cart was deleted.", { status: 404 });
  const ids = (await db.select({ id: schema.cotsCartMembers.partId }).from(schema.cotsCartMembers).where(eq(schema.cotsCartMembers.cartId, cartId))).map((r) => r.id);
  const rows = ids.length ? await db.select().from(schema.parts).where(inArray(schema.parts.id, ids)) : [];
  const all = rows.filter((p) => cartKind(p.cotsLinks[0]?.url));
  const buying = all.filter((p) => BUYING.has(orderStatus(p)));
  const parts = buying.length ? buying : all;
  if (!parts.length) return new NextResponse(`None of this cart's parts has a ${cart.vendor} product link that can go in a cart.`, { status: 400 });

  const { shelf } = await shelfOfParts(parts.filter((p) => p.inventoryItemId));
  // The amount to order as the Order List shows it (typed there, or worked out: lib/cots.ts).
  const toOrder = (p: (typeof parts)[number]) => orderAmount({ ...p, shelf: shelf.get(p.id) ?? null });
  // Parts the shelf already covers stay out, unless that's all of them.
  const short = parts.filter((p) => toOrder(p) > 0);
  const lines: CartLine[] = await Promise.all(
    (short.length ? short : parts).map(async (p) => {
      const url = p.cotsLinks[0].url;
      const quantity = short.length ? toOrder(p) : Math.max(p.quantity, 1);
      if (cartKind(url) !== "shopify" || linkVariant(url)) return { url, quantity };
      const variantId = await shopifyVariantId(url, p.displayName ?? p.onshapeName).catch(() => null);
      return { url, quantity, variantId };
    }),
  );
  const missing = lines.filter((l) => cartKind(l.url) === "shopify" && !l.variantId && !linkVariant(l.url));
  const href = cartUrl(lines.filter((l) => !missing.includes(l)));
  if (!href) return new NextResponse(`${cart.vendor} didn't answer, so the cart couldn't be filled. Try again in a minute.`, { status: 502 });
  return NextResponse.redirect(href, 303);
}
