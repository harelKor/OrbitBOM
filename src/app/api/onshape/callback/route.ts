import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getMember } from "@/lib/auth";
import { requestToken, saveTokens, STATE_COOKIE } from "@/lib/onshape/client";

export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const member = await getMember();
  if (!member) return NextResponse.redirect(`${origin}/login`);

  const cookieStore = await cookies();
  const expected = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete({ name: STATE_COOKIE, path: "/api/onshape" });
  const code = searchParams.get("code");
  if (!code || !expected || searchParams.get("state") !== expected) {
    return NextResponse.redirect(`${origin}/profile?onshape=failed`);
  }

  try {
    const tokens = await requestToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${origin}/api/onshape/callback`,
    });
    await saveTokens(member.id, tokens);
  } catch {
    return NextResponse.redirect(`${origin}/profile?onshape=failed`);
  }
  return NextResponse.redirect(`${origin}/profile?onshape=connected`);
}
