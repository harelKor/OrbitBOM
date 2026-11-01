import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { DAILY_CALL_BUDGET } from "@/lib/onshape/client";
import { TEAMS } from "@/config/teams";
import { TeamPicker } from "@/components/teams/TeamPicker";
import { listTeamSystems } from "@/lib/teams";
import { disconnectOnshape, setOwnTeam } from "./actions";
import { McpTokens } from "./McpTokens";
import { NameForm } from "./NameForm";

const MESSAGES: Record<string, string> = {
  connected: "Onshape is connected.",
  failed: "Connecting Onshape didn't work. Please try again.",
  denied: "Onshape didn't allow the connection. Check that the OrbitParts app is allowed for your Enterprise.",
  expired: "The Onshape sign-in took too long or was opened in another browser. Please try again.",
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
  const mcpTokens = await db
    .select({
      id: schema.mcpTokens.id,
      label: schema.mcpTokens.label,
      createdAt: schema.mcpTokens.createdAt,
      lastUsedAt: schema.mcpTokens.lastUsedAt,
    })
    .from(schema.mcpTokens)
    .where(eq(schema.mcpTokens.memberId, member.id))
    .orderBy(desc(schema.mcpTokens.createdAt));
  const [h, systems] = await Promise.all([headers(), listTeamSystems()]);
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const calls = token?.callsDay === today ? token.callsToday : 0;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <NameForm name={member.name} />
        <p className="text-sm text-muted">
          {member.email}
          {member.isAdmin && " · Admin"}
        </p>
      </div>

      {member.isAdmin ? (
        <TeamPicker team={member.team} systemId={member.systemId} systems={systems} save={setOwnTeam} />
      ) : (
        <TeamBadges team={member.team} system={systems.find((s) => s.id === member.systemId) ?? null} />
      )}

      {onshape && MESSAGES[onshape] && (
        <p className={`rounded-md p-3 text-sm ${onshape === "connected" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {MESSAGES[onshape]}
        </p>
      )}

      <section className="panel space-y-3 p-5">
        <h2 className="font-semibold">Onshape</h2>
        {member.onshapeConnected ? (
          <>
            <p className="text-sm text-fg-2">
              Connected. Syncs you start run on your Onshape account: {calls} of {DAILY_CALL_BUDGET} API calls used today.
            </p>
            <form action={disconnectOnshape}>
              <button className="btn">Disconnect</button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm text-fg-2">
              Connect your Onshape account once so you can update BOMs from Onshape. Each member uses their own
              account, which spreads the daily API limit across the team.
            </p>
            <a href="/api/onshape/connect" className="btn-primary">
              Connect Onshape
            </a>
          </>
        )}
      </section>

      <section className="panel space-y-3 p-5">
        <h2 className="font-semibold">Use OrbitParts from Claude</h2>
        <p className="text-sm text-fg-2">
          Add OrbitParts to your own Claude as a connector, then change the BOM with prompts like &ldquo;Set CNC as
          Process 1 for every 5mm aluminum plate in Drivetrain&rdquo;. Claude shows you every change before it applies
          it, and each change can be undone.
        </p>
        <McpTokens tokens={mcpTokens} origin={origin} />
      </section>
    </div>
  );
}

// Non-admins see their team read-only; an admin sets it on /members.
function TeamBadges({ team, system }: { team: string | null; system: { name: string; robotName: string } | null }) {
  const label = TEAMS.find((t) => t.id === team)?.label ?? "Unassigned";
  return (
    <section className="panel flex flex-wrap items-center gap-2 p-4 text-sm">
      <span className="text-muted">Team</span>
      <span className={`rounded-full border px-2.5 py-0.5 font-medium ${team ? "border-sky-400/40 bg-sky-500/10 text-accent" : "border-line text-fg-2"}`}>
        {label}
      </span>
      {team === "cad" && system && (
        <span className="rounded-full border border-line px-2.5 py-0.5 text-fg-2">
          {system.robotName} · {system.name}
        </span>
      )}
      <span className="w-full text-xs text-muted">An admin sets your team on the Members page.</span>
    </section>
  );
}
