import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import {
  approveRequest,
  createInvite,
  denyRequest,
  removeMember,
  revokeInvite,
  setAdmin,
  setMentor,
} from "./actions";
import { TEAMS } from "@/config/teams";
import { listTeamSystems } from "@/lib/teams";
import { CopyLink } from "./CopyLink";
import { MemberSearch } from "./MemberSearch";
import { MemberTeam } from "./MemberTeam";
import { RemoveMember } from "./RemoveMember";

export default async function MembersPage() {
  const me = await requireMember();
  const [members, systems] = await Promise.all([
    db.select().from(schema.members).orderBy(asc(schema.members.name)),
    listTeamSystems(),
  ]);
  const systemName = new Map(systems.map((s) => [s.id, s.name]));

  const [invites, requests] = me.isAdmin
    ? await Promise.all([
        db
          .select()
          .from(schema.invites)
          .where(and(isNull(schema.invites.usedAt), gt(schema.invites.expiresAt, new Date())))
          .orderBy(desc(schema.invites.createdAt)),
        db
          .select()
          .from(schema.joinRequests)
          .where(eq(schema.joinRequests.status, "pending"))
          .orderBy(asc(schema.joinRequests.createdAt)),
      ])
    : [[], []];

  return (
    <div className="max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold">Members</h1>

      {me.isAdmin && requests.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">Join requests</h2>
          <ul className="panel divide-y divide-line">
            {requests.map((r) => (
              <li key={r.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div dir="auto" className="truncate font-medium">{r.name}</div>
                  <div className="truncate text-sm text-muted">{r.email}</div>
                </div>
                <form action={approveRequest.bind(null, r.userId)}>
                  <button className="btn">Approve</button>
                </form>
                <form action={denyRequest.bind(null, r.userId)}>
                  <button className="btn">Deny</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <MemberSearch total={members.length}>
          {members.map((m) => (
            <li
              key={m.id}
              data-search={[m.name, me.isAdmin && m.email, TEAMS.find((t) => t.id === m.team)?.label, m.systemId && systemName.get(m.systemId), m.isAdmin && "admin", m.isMentor && "mentor"]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  <bdi>{m.name}</bdi>
                  {m.isAdmin && (
                    <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[0.6875rem] text-white">
                      Admin
                    </span>
                  )}
                  {m.isMentor && <span className="ml-2 rounded bg-sky-600 px-1.5 py-0.5 text-[0.6875rem] text-white">Mentor</span>}
                </div>
                {/* Emails are for admins only (audit, 2026-11-20): members see each other's team. */}
                {me.isAdmin ? (
                  <div className="truncate text-sm text-muted">{m.email}</div>
                ) : (
                  m.team && (
                    <div className="truncate text-sm text-muted">
                      {TEAMS.find((t) => t.id === m.team)?.label}
                      {m.team === "cad" && m.systemId && systemName.has(m.systemId) && `, ${systemName.get(m.systemId)}`}
                    </div>
                  )
                )}
              </div>
              {me.isAdmin && <MemberTeam memberId={m.id} team={m.team} systemId={m.systemId} systems={systems} />}
              {me.isAdmin && (
                <form action={setMentor.bind(null, m.id, !m.isMentor)}>
                  <button className="btn" title="Mentors approve or reject ticked-off CAD comments">
                    {m.isMentor ? "Not a mentor" : "Make mentor"}
                  </button>
                </form>
              )}
              {me.isAdmin && m.id !== me.id && (
                <>
                  <form action={setAdmin.bind(null, m.id, !m.isAdmin)}>
                    <button className="btn">{m.isAdmin ? "Remove admin" : "Make admin"}</button>
                  </form>
                  <RemoveMember name={m.name} action={removeMember.bind(null, m.id)} />
                </>
              )}
            </li>
          ))}
      </MemberSearch>

      {me.isAdmin && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-medium">Invite links</h2>
            <form action={createInvite}>
              <button className="btn">New invite link</button>
            </form>
          </div>
          <p className="mb-2 text-sm text-muted">
            Each link works once and expires after 7 days.
          </p>
          {invites.length === 0 ? (
            <p className="text-sm text-subtle">No open invite links.</p>
          ) : (
            <ul className="panel divide-y divide-line">
              {invites.map((i) => (
                <li key={i.token} className="flex items-center gap-3 px-4 py-3">
                  <code className="min-w-0 flex-1 truncate text-sm text-fg-2">
                    /invite/{i.token}
                  </code>
                  <span className="text-xs text-muted">
                    expires {i.expiresAt.toISOString().slice(0, 10)}
                  </span>
                  <CopyLink path={`/invite/${i.token}`} />
                  <form action={revokeInvite.bind(null, i.token)}>
                    <button className="text-sm text-rose-700">Revoke</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
