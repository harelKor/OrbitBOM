@AGENTS.md

# OrbitBOM (shown to users as OrbitParts)

FRC team 1690's BOM, To Fab and inventory app, modelled on FRCBOM and linked to Onshape. Owner:
Harel. Live: https://orbitparts.duckdns.org. Next.js 16 (App Router, Cache Components off,
`src/proxy.ts` instead of middleware), React 19, Drizzle + node-postgres on Supabase Free
(Postgres + Google sign-in, Mumbai), Cloudflare R2 for files, hosted on the team's own Oracle Cloud
Always Free VM in Mumbai (see Hosting below; not Vercel any more), vitest.
Everything must stay on free tiers. Members also drive it from their own Claude through the MCP
server (`/api/mcp/<token>`).

## Working with Harel

- Ship straight to `main`: commit, push. The "Deploy" workflow builds it on GitHub and switches
  the server over (~3 min; check with `gh run list --workflow deploy.yml`). No branches or PRs
  unless he asks. `.github/workflows/migrate.yml` applies new migrations on the same push; when
  deployed code needs a new table on every request, wait for that run before calling it done.
- Everything must cost nothing. Before any new cloud resource or plan change, check it's inside
  the free tier and say so; he asked to be sure he pays nothing.
- Build what he asks for (or what blocks real use), nothing optional. Big features: post the plan,
  wait for his go. Reply with results, what to check and blockers, not CI/deploy chatter.
- Live data changes (bulk renames, seed routes, deletes on production) only after his OK.
- He sometimes pastes secrets: never repeat or use them; tell him to rotate.

## Commands

- `npm run dev` · `npm run lint` · `npm run typecheck` · `npm test` (unit only)
- `npm run test:db`: every test, database ones included, against CI's Postgres 17 in Docker (port
  54329); `-- <path>` for some files, `-- --down` to stop it. Run before pushing anything that
  touches the database. As of 2026-11-04, 5 tests fail on `main` already (inventory.db ×3,
  cotsSync.db ×1, updateBom.db "pulls a new system's BOM"): compare against those.
- Schema: edit `src/db/schema.ts`, `npm run db:generate`, rename the file to a readable name
  (and its `tag` in `drizzle/meta/_journal.json`), add `ALTER TABLE "x" ENABLE ROW LEVEL SECURITY;`
  for a new table, commit. Next migration: 0082.
- Local site: README "Local development" (local Supabase in Docker, "Dev sign-in" button; Onshape
  and R2 deliberately unset). Never point local dev at production.
- On Harel's Windows PC, Docker and `gh` aren't on the Bash PATH: run them from PowerShell, or
  `"/c/Program Files/GitHub CLI/gh"`.

## Hosting (own server since 2026-11-07)

Vercel Hobby's 4 Active-CPU-hours a month ran out and paused the site (2026-11-06), so it moved.
Details and commands: `docs/runbook.md` → "The server"; files in `deploy/`.

- Site: https://orbitparts.duckdns.org (DuckDNS → the VM's IP). Live VM `orbitparts`, IP
  80.225.254.7: Oracle's free Ampere `VM.Standard.A1.Flex`, 1 OCPU / 6 GB (ARM, aarch64; got on
  2026-11-07 after the retry script), Ubuntu 24.04, Caddy (HTTPS) → Next's standalone `server.js`
  on 127.0.0.1:3000 as systemd service `orbitparts`. Admin SSH from Harel's PC:
  `ssh -i ~/.ssh/orbitparts_admin ubuntu@80.225.254.7`; logs `sudo journalctl -u orbitparts -f`.
- Spare VM `orbitparts-micro`, 130.210.0.82 (free AMD E2.1.Micro, x86, 1 GB + 2 GB swap): the
  first home, same setup, app still running but its daily timer disabled. To fall back, point
  DuckDNS and the `DEPLOY_HOST` / `DEPLOY_KNOWN_HOSTS` secrets at it and enable the timer.
- Deploy: `.github/workflows/deploy.yml` runs `next build` on GitHub (the VM is too small), uploads
  the bundle, `deploy/release.sh` swaps `/opt/orbitparts/current`, restarts, and rolls back if
  `/login` doesn't answer. `next.config.ts` has `output: "standalone"` and unoptimized images.
- Env vars live in `/opt/orbitparts/shared/.env` (systemd EnvironmentFile), not Vercel. A new one:
  `printf '%s' "$V" | ssh … "sudo -u orbit /opt/orbitparts/bin/set-env KEY"` (or `--generate`),
  then `sudo systemctl restart orbitparts`; Harel enters real secrets with
  `bash deploy/enter-secrets.sh 80.225.254.7 KEY…` (Git Bash). `NEXT_PUBLIC_*` are baked in at
  build time, so they are also GitHub secrets. Writing GitHub secrets is blocked for Claude: hand
  Harel the `gh secret set` command. The DB URL comes from `PRODUCTION_DIRECT_URL` via Actions →
  "Server env".
- Scheduled work: systemd timers on the VM, not `vercel.json` crons. The old Vercel project still
  exists, paused until 2026-12-06; Harel left it for now, and it should be disconnected before
  then or it deploys and runs its cron again next to the server. Daily `orbitparts-keep-alive.timer` (06:00 UTC) calls
  `/api/cron/keep-alive`. A new cron = a new timer in `deploy/setup.sh` (and on the VM).
- No serverless limits: `maxDuration` is ignored and requests can run long, but it's one small
  shared machine: keep heavy CPU/memory work (big meshes, layouts) in the browser or chunked.
- R2's CORS policy must list the site's origin (browsers load 3D files and upload straight to
  R2); a missing origin shows as "The 3D model couldn't load".
- Oracle: free account (not Pay As You Go), home region Mumbai. Quota policy "pay" caps compute
  at the free shapes (A1 2 OCPU/12 GB in total, one E2 micro); 1 OCPU / 6 GB of A1 is still
  unused. Free VMs that look idle for 7 days can be stopped by Oracle: if the site is down, start
  the instance in the console. Mumbai is usually out of A1 capacity: `~/.oci/grab_server.py` on
  Harel's PC (OCI API config in `~/.oci/config`) retries a launch about once a minute, which is
  Oracle's rate limit. Moving to another VM = `deploy/setup.sh`, copy the `.env` and the current
  release, point DuckDNS and the `DEPLOY_HOST` / `DEPLOY_KNOWN_HOSTS` secrets at it.

## Rules

- The BOM, inventory and Onshape behaviour copy FRCBOM; don't redesign them.
- Fixed lists live in `src/config/` (statuses, machines, materials, refresh, `onshapeBudget.ts`).
  Edited on `/settings` instead: inventory categories and their fields (`inventory_categories`,
  seeded from `src/config/inventory.ts`), locations, conditions, base materials.
- A BOM part's material is an inventory item (`material` = its name, `inventoryItemId` = its id).
  Pickers read `useMaterials()` (client, fetched from `/api/materials`) or `listMaterialGroups()` /
  `listRawStock()` (server): Raw Stock categories first. `MATERIALS` only feeds inventory "BOM
  material" spec fields and 3D colours.
- Status always comes from `computeStatus` in `src/lib/status.ts` (`isDone` there too).
- Database access only on the server through Drizzle (`src/db`). RLS is on with no policies, so
  the browser's Supabase key can't read tables.
- Onshape tokens and keys never reach the browser. Never call Onshape while rendering a page.
- Roles: modes edit (admin) / cad / build / none and capabilities (work, draw, review, sync,
  classify, shape, manage) in `src/components/shell/mode.ts`. Every server action and route checks
  them itself (`requireMember` / `requireCapability` / `requireAdmin` in `src/lib/auth.ts`,
  `src/lib/mode.ts`; status rules through `statusChangeDenied`).

## Where to make a change (use these, don't write around them)

- Part edits: `planPartUpdate` (`src/lib/parts/changes.ts`) + `applyEachPartChanges` /
  `applyPartChanges` (`src/lib/parts/apply.ts`): locks the rows, writes `part_history` under one
  batch (undo, Recent actions, AI log revert depend on it). Pass `tx` to join a transaction.
  Counters send `add: { field: ±n }`, never a total.
- Stock: `moveStock` / `setStock` / `editPieces` (`src/lib/inventory/moves.ts`, row locked, move
  logged). New items: `createItem` (`src/lib/inventory/create.ts`).
- Deleting a robot, system, manual part or item: `deleteToTrash` (`src/lib/trash.ts`) so it shows
  in Settings → Recently deleted for 30 days.
- Onshape: `onshapeClient(memberId, baseUrl, { background })` (`src/lib/onshape/client.ts`) counts
  every call against the team budget (`src/config/onshapeBudget.ts`, `onshape_usage`); automatic
  work (thumbnails, previews) passes `background: true` so it stops first.
- Versions: `src/lib/versions/` (check → draft → commit; `checkSystem` re-checks under a lock).
  A system with `followVersions` is read at its CAD document's newest Onshape version (no
  Manufacture document).
- CAD (was "CAD Review"): `/robots/<id>/cad-review` is the whole robot on
  `src/components/review/ReviewScreen.tsx` (page wrapper `cad-review/CadReview.tsx`); a system's
  Isolate scopes it to that system (`?system=<id>`). The old `/cad-review/robot` and
  `/systems/<id>/cad-review` URLs redirect there. Comments with no system are on the whole robot. Comments: `src/lib/reviews/comments.ts` (anyone adds,
  CAD ticks, `members.isMentor` approves/rejects); version tree `src/lib/reviews/tree.ts` from the
  kept Onshape version list (`src/lib/versions/docVersions.ts`) and the BOM versions. No calls.
  The whole 3D view as data (camera, hidden / isolated, section, render mode, colours):
  `src/components/viewer/viewState.ts`, in the URL hash (`#v=`), on each comment with its pin
  (`pins.ts`, assembly mm), and as Onshape's Named views per robot (`src/lib/reviews/namedViews.ts`).
- 3D views (every viewer: CAD pages, BOM pages, part windows, Commit window): `ModelCanvas`
  (`src/components/dashboard/ModelCanvas.tsx`), tools in `src/components/review/ViewerToolbar.tsx`,
  picking / measuring maths in `src/lib/model/topology.ts`, `measure.ts`. Being reworked to work
  like Onshape: see "Work in progress" below.

## Work in progress

- **CAD 3D viewer rework** (planned 2026-11-10): `plan/cad-3d-viewer.md` is the live plan and
  handoff. Its "Progress" table says which session (S0–S9) is next; each session reads its brief
  there, owns only its files, and updates the table when it ships. Decided by Harel: Shift+Y
  brings back the hidden part under the mouse, no parts list, motion along the mates waits for
  its own plan, the `/dev/viewer` sandbox stays small. Don't touch `ModelCanvas` for other work
  while S0 (the split into `src/components/viewer/`) is in progress.
- Assembly page (`/robots/<id>/assembly`, plan/assembly-guides.md): sub-assemblies come from the
  part number (`src/lib/assembly/groups.ts`, 1690-26-421-01 → "42"), steps and ticks in
  `src/lib/assembly/steps.ts` (CAD writes with `instruct`, any team member ticks with `work`), page
  logic in `src/lib/assembly/view.ts`, UI in `src/components/assembly/`. `/dev/assembly` = sandbox.
- Files: `src/lib/storage/r2.ts`; backups and restore: `src/lib/storage/backup.ts`, `restore.ts`.
- Work the user needn't wait for: `afterResponse` (`src/lib/later.ts`).
- MCP: `src/lib/mcp/registry.ts` (`read` / `write`, preview → confirm token → apply) and one file
  per area in `src/lib/mcp/toolsets/`; `src/lib/mcp/tools.test.ts` counts the tools.
- To Fab: `src/components/fab/` (`fabModel.ts` rules, `BatchCard`, `MachineFilters`, Auto Layout in
  `BatchLayoutDialog` + `src/lib/fab/layout.ts`, `batchLayout.ts`).
- Data loaders for pages: `src/lib/data/`. The `(app)` layout must stay light: it runs on every
  navigation and every save.

## Gotchas

- Browsers run server actions one at a time: slow reads (search, popups) go in GET route handlers.
- A Drizzle query runs again each time it's awaited: wrap it in `Promise.resolve()` to share it.
- Supabase's transaction pooler (6543): node-postgres, no prepared statements, don't add pool
  startup options without testing them there.
- Absolute URLs to our own site (OAuth redirect_uri, redirects built from an origin): use
  `publicOrigin(request)` (`src/lib/origin.ts`). Behind Caddy `request.nextUrl.origin` is
  `https://localhost:3000`, so build redirects as `new URL(path, publicOrigin(request))`. Only
  `request.nextUrl.clone()` redirects (as in `src/proxy.ts`) come out right on their own.
- Next 16 `error.tsx` gets `retry`, not `reset`. Read `node_modules/next/dist/docs/` before using
  an API you haven't checked.
- Dates in client components: `LocalTime` (`src/components/ui/LocalTime.tsx`), or hydration breaks.
- UI: tokens and utilities in `src/app/globals.css`, primitives in `src/components/ui/`, windows in
  `src/components/Dialog.tsx`. Touch targets ≥ 36px on `pointer-coarse`, `tabular-nums` for numbers,
  `active:scale-[0.98]` on pressables. Test at phone width; the shop uses phones.
- Don't run Prettier: the repo isn't formatted with it (long lines are fine).
- Comments say why, in plain words; product decisions carry "(Harel, YYYY-MM-DD)".
- Design notes behind the code: `plan/` (historical; the code wins when they disagree).
