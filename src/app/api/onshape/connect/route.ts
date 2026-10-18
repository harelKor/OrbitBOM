import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getMember } from "@/lib/auth";
import { OAUTH_BASE, STATE_COOKIE } from "@/lib/onshape/client";

// Starts "Connect Onshape": sends the member to Onshape's consent page.
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  if (!(await getMember())) return NextResponse.redirect(`${origin}/login`);
  if (!process.env.ONSHAPE_CLIENT_ID) {
    return NextResponse.redirect(`${origin}/profile?onshape=not-configured`);
  }
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/onshape",
    maxAge: 600,
  });
  const url = new URL(`${OAUTH_BASE}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: process.env.ONSHAPE_CLIENT_ID,
    redirect_uri: `${origin}/api/onshape/callback`,
    state,
  }).toString();
  return NextResponse.redirect(url);
}
