# OrbitBOM

Team 1690's bill of materials and inventory app, linked to Onshape. It works the same way as
FRCBOM: robots → systems → BOM rows synced from Onshape assemblies, with statuses, machines,
materials, files and an inventory that allocates COTS stock to robots. Members can also change
the BOM from their own Claude through an MCP server.

## Stack

- Next.js (App Router, TypeScript) on the team's own Oracle Cloud Always Free server (`deploy/`)
- Supabase Free: Postgres, Google sign-in
- Drizzle for the schema and migrations (`src/db/schema.ts`, `drizzle/`)
- Cloudflare R2 for files, thumbnails, 3D meshes, exports and the nightly backups
- Tailwind CSS

All hosting is on free tiers. A daily timer on the server keeps Supabase from pausing and saves the
nightly backup to R2 (Settings → Backups); see `docs/runbook.md`. Working on the code: start with
`CLAUDE.md` (rules, commands, where each kind of change goes).

## Where things live

| Path | What |
|---|---|
| `src/config/` | Fixed lists: statuses, machines, materials, file types, refresh timing, the Onshape call budget. Inventory categories, locations, conditions and base materials are edited on `/settings` instead. |
| `src/lib/status.ts` | `computeStatus`, the one status function shared by the UI, stats and MCP |
| `src/lib/auth.ts`, `src/lib/mode.ts`, `src/components/shell/mode.ts` | Sign-in, roles (modes) and the capability checks every action runs |
| `src/lib/parts/`, `src/lib/inventory/`, `src/lib/versions/` | Part changes with history and undo, stock and items, system versions |
| `src/lib/onshape/` | The Onshape client (team call budget), BOM, thumbnails, exports |
| `src/lib/mcp/` | The MCP server's tools, one file per area in `toolsets/` |
| `src/lib/data/` | What each page loads |
| `src/db/schema.ts`, `drizzle/` | Database schema and migrations |
| `plan/` | The design notes features were built from (history) |
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

3D: open `/dev/viewer`. It draws a small made-up robot (`src/lib/model/sandbox.ts`) in the CAD
viewer with its tools (views, section, picks and measure, hide / Shift+Y, isolate, colours,
Locate), with no Onshape, no R2 and no sign-in; it needs no `.env.local` at all. It answers 404 in
production.

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
- Each member works in a mode: Edit (admins), CAD Team, Build Team or read-only; what each may
  change is in `src/components/shell/mode.ts`. Admins also invite and remove members, delete
  robots and systems (kept 30 days in Settings → Recently deleted) and restore backups.

## Onshape test

```sh
npm run onshape:test -- "https://<host>/documents/<did>/w/<wid>/e/<assembly eid>"
```

Needs `ONSHAPE_ACCESS_KEY` and `ONSHAPE_SECRET_KEY` in `.env.local`. It runs each read the app
will make (change check, discovery, BOM, geometry, thumbnail, STL and STEP export), prints the BOM
columns with their property IDs and the call count per step, and never writes to Onshape.

Setting up the accounts: `docs/setup.md`.
