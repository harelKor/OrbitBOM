import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { INVITE_COOKIE, resolveMembership } from "@/lib/membership";
import { safeNext } from "@/lib/safeNext";
import { createClient } from "@/lib/supabase/server";

// Google sends the user back here. Exchange the code for a session, then sort out membership.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (!code) return NextResponse.redirect(`${origin}/login?error=1`);
  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=1`);

  const user = await getUser();
  if (!user) return NextResponse.redirect(`${origin}/login?error=1`);

  const cookieStore = await cookies();
  const inviteToken = cookieStore.get(INVITE_COOKIE)?.value;
  const member = await resolveMembership(user, inviteToken);
  if (inviteToken) cookieStore.delete(INVITE_COOKIE);

  return NextResponse.redirect(`${origin}${member ? next : "/pending"}`);
}
