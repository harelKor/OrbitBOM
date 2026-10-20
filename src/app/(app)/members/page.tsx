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
} from "./actions";
import { CopyLink } from "./CopyLink";

export default async function MembersPage() {
  const me = await requireMember();
  const members = await db.select().from(schema.members).orderBy(asc(schema.members.name));

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
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="truncate text-sm text-slate-400">{r.email}</div>
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

      <section>
        <h2 className="mb-2 font-medium">Team ({members.length})</h2>
        <ul className="panel divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {m.name}
                  {m.isAdmin && (
                    <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[11px] text-white">
                      Admin
                    </span>
                  )}
                </div>
                <div className="truncate text-sm text-slate-400">{m.email}</div>
              </div>
              {me.isAdmin && m.id !== me.id && (
                <>
                  <form action={setAdmin.bind(null, m.id, !m.isAdmin)}>
                    <button className="btn">{m.isAdmin ? "Remove admin" : "Make admin"}</button>
                  </form>
                  <form action={removeMember.bind(null, m.id)}>
                    <button className="btn-danger">Remove</button>
                  </form>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {me.isAdmin && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-medium">Invite links</h2>
            <form action={createInvite}>
              <button className="btn">New invite link</button>
            </form>
          </div>
          <p className="mb-2 text-sm text-slate-400">
            Each link works once and expires after 7 days.
          </p>
          {invites.length === 0 ? (
            <p className="text-sm text-slate-500">No open invite links.</p>
          ) : (
            <ul className="panel divide-y divide-line">
              {invites.map((i) => (
                <li key={i.token} className="flex items-center gap-3 px-4 py-3">
                  <code className="min-w-0 flex-1 truncate text-sm text-slate-300">
                    /invite/{i.token}
                  </code>
                  <span className="text-xs text-slate-400">
                    expires {i.expiresAt.toISOString().slice(0, 10)}
                  </span>
                  <CopyLink path={`/invite/${i.token}`} />
                  <form action={revokeInvite.bind(null, i.token)}>
                    <button className="text-sm text-rose-300">Revoke</button>
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
