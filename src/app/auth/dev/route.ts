import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { resolveMembership } from "@/lib/membership";
import { safeNext } from "@/lib/safeNext";
import { createClient } from "@/lib/supabase/server";

// Local development only: Google sign-in can't reach the local Supabase (npx supabase start), so
// this signs in a test account by password. It answers 404 unless DEV_LOGIN=1 and Supabase is on
// this machine, so it never works against the real project. ADMIN_EMAILS makes the account an admin.
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/;

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const email = process.env.DEV_LOGIN_EMAIL;
  const password = process.env.DEV_LOGIN_PASSWORD;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.NODE_ENV === "production" || process.env.DEV_LOGIN !== "1" || !LOCAL.test(url) || !email || !password || !serviceKey) {
    return new NextResponse(null, { status: 404 });
  }
  const { origin, searchParams } = request.nextUrl;

  // The account is made on first use; "already registered" afterwards is fine.
  const admin = createAdminClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Dev Admin" } });

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return NextResponse.redirect(`${origin}/login?error=1`);
  const user = await getUser();
  const member = user ? await resolveMembership(user, undefined) : null;
  return NextResponse.redirect(`${origin}${member ? safeNext(searchParams.get("next")) : "/pending"}`);
}
