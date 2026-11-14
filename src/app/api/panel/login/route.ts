import { and, count, eq, gt, lt } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@/db";
import { hashPanelCode, newPanelCode, PANEL_COOKIE, panelCookieOptions, panelSessionValue } from "@/lib/panelSession";

const { panelLogins } = schema;
const CODE_LIFETIME_MS = 10 * 60_000;

// Anyone may ask for a code (the panel isn't signed in yet), so codes are limited: a few per
// address in the lifetime of a code (kept in this one server process; Caddy sets
// X-Forwarded-For to the caller's address), and a ceiling on the codes waiting at once.
const PER_ADDRESS = 10;
const OPEN_CODES = 100;
const asked = new Map<string, number[]>();

function tooMany(address: string) {
  const since = Date.now() - CODE_LIFETIME_MS;
  for (const [a, times] of asked) if (!times.some((t) => t > since)) asked.delete(a);
  const times = (asked.get(address) ?? []).filter((t) => t > since);
  if (times.length >= PER_ADDRESS) return true;
  asked.set(address, [...times, Date.now()]);
  return false;
}

// The panel asks for a code, opens /onshape/connect?code=… in a popup, and polls GET until the
// member approves it there. The approved code is exchanged once for the panel cookie.
export async function POST(request: NextRequest) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const slowDown = () => NextResponse.json({ error: "Too many sign-in codes. Wait a few minutes and try again." }, { status: 429 });
  if (tooMany(address)) return slowDown();
  await db.delete(panelLogins).where(lt(panelLogins.createdAt, new Date(Date.now() - CODE_LIFETIME_MS)));
  const [{ open }] = await db.select({ open: count() }).from(panelLogins);
  if (open >= OPEN_CODES) return slowDown();
  const code = newPanelCode();
  await db.insert(panelLogins).values({ codeHash: hashPanelCode(code) });
  return NextResponse.json({ code });
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const fresh = and(
    eq(panelLogins.codeHash, hashPanelCode(code)),
    gt(panelLogins.createdAt, new Date(Date.now() - CODE_LIFETIME_MS)),
  );
  const [login] = await db.select().from(panelLogins).where(fresh).limit(1);
  if (!login) return NextResponse.json({ state: "expired" });
  if (!login.memberId) return NextResponse.json({ state: "waiting" });

  const [claimed] = await db.delete(panelLogins).where(fresh).returning();
  if (!claimed?.memberId) return NextResponse.json({ state: "expired" });
  const response = NextResponse.json({ state: "signed-in" });
  response.cookies.set(PANEL_COOKIE, panelSessionValue(claimed.memberId), panelCookieOptions);
  return response;
}
