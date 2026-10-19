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
  if (searchParams.get("error")) {
    console.error("Onshape connect refused:", searchParams.get("error"), searchParams.get("error_description"));
    return NextResponse.redirect(`${origin}/profile?onshape=denied`);
  }
  if (!code || !expected || searchParams.get("state") !== expected) {
    console.error("Onshape connect: missing code or state mismatch", { code: !!code, expected: !!expected });
    return NextResponse.redirect(`${origin}/profile?onshape=expired`);
  }

  try {
    const tokens = await requestToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${origin}/api/onshape/callback`,
    });
    await saveTokens(member.id, tokens);
  } catch (err) {
    // Shows in Vercel → Logs; never includes the code or tokens.
    console.error("Onshape connect failed:", (err as Error).message);
    return NextResponse.redirect(`${origin}/profile?onshape=failed`);
  }
  return NextResponse.redirect(`${origin}/profile?onshape=connected`);
}
