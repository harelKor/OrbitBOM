# OrbitBOM

Team 1690's bill of materials and inventory app, linked to Onshape. It works the same way as
FRCBOM: robots → systems → BOM rows synced from Onshape assemblies, with statuses, machines,
materials, files and an inventory that allocates COTS stock to robots. Members can also change
the BOM from their own Claude through an MCP server.

## Stack

- Next.js (App Router, TypeScript) on Vercel Hobby
- Supabase Free: Postgres, Google sign-in
- Drizzle for the schema and migrations (`src/db/schema.ts`, `drizzle/`)
- Cloudflare R2 for files (coming with the files milestone)
- Tailwind CSS

All hosting is on free tiers. A daily cron keeps Supabase from pausing, and a nightly GitHub
Action backs up the database (see `docs/runbook.md`).

## Where things live

| Path | What |
|---|---|
| `src/config/` | Statuses, machines, materials, file types, inventory part types, Onshape property IDs. There is no settings UI: edit these files. |
| `src/lib/status.ts` | `computeStatus`, the one status function shared by the UI, stats and MCP |
| `src/lib/auth.ts`, `src/lib/membership.ts` | Sign-in, members, invites and join requests |
| `src/lib/onshape/` | Onshape helpers |
| `src/db/schema.ts` | Database schema |
| `scripts/onshape-test.ts` | Pulls one real system from Onshape and counts the API calls |

## Local development

Against a local Supabase in Docker, never the real project (Docker Desktop must be running):

```sh
npm install
npx supabase start           # local Postgres + Auth from supabase/config.toml; prints its URL and keys
# .env.local: NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY from that
# output, DATABASE_URL = DIRECT_URL = its DB_URL, DEV_LOGIN=1, DEV_LOGIN_EMAIL, DEV_LOGIN_PASSWORD,
# and the same email in ADMIN_EMAILS (see .env.example for the rest)
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run db:migrate
npm run dev                  # then "Dev sign-in (local database)" on the login page
```

Google sign-in can't reach the local Supabase, so `/auth/dev` signs in the DEV_LOGIN account by
password; it answers 404 in production and whenever Supabase isn't on this machine. Leave Onshape
and R2 unset locally so nothing spends the team's Onshape calls or touches the real bucket.
`npx supabase stop` stops it (its data is kept for the next start).

Checks: `npm run lint`, `npm run typecheck`, `npm test`. Database tests run when
`TEST_DATABASE_URL` points at a migrated Postgres (CI does this). `npm run test:db` does it
locally: it starts CI's Postgres in Docker (Docker Desktop must be running), migrates it and runs
every test; `npm run test:db -- --down` stops it.

After changing `src/db/schema.ts`, run `npm run db:generate` and commit the new file in
`drizzle/`.

## Members

- Sign-in is Google only.
- Emails in `ADMIN_EMAILS` become admins the first time they sign in.
- Everyone else joins with a single-use invite link from the Members page, or signs in and
  waits for an admin to approve their join request.
- **Member**: edits everything in the BOM and inventory. **Admin**: also invites and removes
  members, deletes robots, systems and files, and sees the Advanced Onshape panel.

## Onshape test

```sh
npm run onshape:test -- "https://<host>/documents/<did>/w/<wid>/e/<assembly eid>"
```

Needs `ONSHAPE_ACCESS_KEY` and `ONSHAPE_SECRET_KEY` in `.env.local`. It runs each read the app
will make (change check, discovery, BOM, geometry, thumbnail, STL and STEP export), prints the BOM
columns with their property IDs and the call count per step, and never writes to Onshape.

Setting up the accounts: `docs/setup.md`.
