import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { DAILY_CALL_BUDGET } from "@/lib/onshape/client";
import { disconnectOnshape } from "./actions";

const MESSAGES: Record<string, string> = {
  connected: "Onshape is connected.",
  failed: "Connecting Onshape didn't work. Please try again.",
  "not-configured": "The Onshape app isn't set up on the server yet (ONSHAPE_CLIENT_ID).",
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ onshape?: string }>;
}) {
  const member = await requireMember();
  const { onshape } = await searchParams;
  const [token] = await db
    .select({ callsToday: schema.onshapeTokens.callsToday, callsDay: schema.onshapeTokens.callsDay })
    .from(schema.onshapeTokens)
    .where(eq(schema.onshapeTokens.memberId, member.id))
    .limit(1);
  const today = new Date().toISOString().slice(0, 10);
  const calls = token?.callsDay === today ? token.callsToday : 0;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{member.name}</h1>
        <p className="text-sm text-slate-400">
          {member.email}
          {member.isAdmin && " · Admin"}
        </p>
      </div>

      {onshape && MESSAGES[onshape] && (
        <p className={`rounded-md p-3 text-sm ${onshape === "connected" ? "bg-emerald-950 text-emerald-200" : "bg-rose-950 text-rose-200"}`}>
          {MESSAGES[onshape]}
        </p>
      )}

      <section className="panel space-y-3 p-5">
        <h2 className="font-semibold">Onshape</h2>
        {member.onshapeConnected ? (
          <>
            <p className="text-sm text-slate-300">
              Connected. Syncs you start run on your Onshape account: {calls} of {DAILY_CALL_BUDGET} API calls used today.
            </p>
            <form action={disconnectOnshape}>
              <button className="btn">Disconnect</button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-300">
              Connect your Onshape account once so you can update BOMs from Onshape. Each member uses their own
              account, which spreads the daily API limit across the team.
            </p>
            <a href="/api/onshape/connect" className="btn-primary">
              Connect Onshape
            </a>
          </>
        )}
      </section>
    </div>
  );
}
