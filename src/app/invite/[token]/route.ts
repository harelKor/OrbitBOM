import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getMember, getUser } from "@/lib/auth";
import { INVITE_COOKIE, INVITE_TTL_DAYS, redeemInvite } from "@/lib/membership";

// An invite link. Signed-in users redeem it right away; everyone else signs in first, and the
// token rides along in a short-lived cookie that the auth callback redeems.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = request.nextUrl.origin;
  const user = await getUser();

  if (user) {
    if (await getMember()) return NextResponse.redirect(`${origin}/`);
    const member = await redeemInvite(user, token);
    return NextResponse.redirect(`${origin}${member ? "/" : "/pending?invite=invalid"}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(INVITE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * INVITE_TTL_DAYS,
  });
  return NextResponse.redirect(`${origin}/login`);
}
