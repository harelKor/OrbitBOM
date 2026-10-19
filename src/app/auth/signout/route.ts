import { NextResponse, type NextRequest } from "next/server";
import { PANEL_COOKIE, panelCookieOptions } from "@/lib/panelSession";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const response = NextResponse.redirect(`${request.nextUrl.origin}/login`, { status: 303 });
  response.cookies.set(PANEL_COOKIE, "", { ...panelCookieOptions, maxAge: 0 });
  return response;
}
