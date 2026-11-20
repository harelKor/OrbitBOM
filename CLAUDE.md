@AGENTS.md

# OrbitBOM (shown to users as OrbitParts)

FRC team 1690's BOM, To Fab and inventory app, modelled on FRCBOM and linked to Onshape. Owner:
Harel. Live: https://orbitparts.duckdns.org. Next.js 16 (App Router, Cache Components off,
`src/proxy.ts` instead of middleware), React 19, Drizzle + node-postgres on Supabase Free
(Postgres + Google sign-in, Mumbai), Cloudflare R2 for files, hosted on the team's own Oracle Cloud
Always Free VM in Mumbai (see Hosting below; not Vercel any more), vitest.
Everything must stay on free tiers. Members also drive it from their own Claude through the MCP
server (`/api/mcp/<token>`). New to the code: `docs/overview.md` (glossary, roles, page map);
last full audit and what's still open: `plan/audit-2026-11-14.md` §0.

## Working with Harel

- Ship straight to `main`: commit, push. The "Deploy" workflow (`deploy.yml`, the only one on
  push) runs lint, typecheck and every test, builds once, applies new migrations, then switches the
  server over (~5 min; check with `gh run list --workflow deploy.yml`). A red check deploys
  nothing, so a push isn't done until that run is green. No branches or PRs unless he asks.
  Pushes touching only `plan/`, `docs/`, `*.md` don't run it; a newer push cancels an older run's
  checks. Actions minutes are tight (private repo, 2,000/month): batch pushes. They ran out on
  2026-11-16 (runs fail to start: "spending limit"); until they reset at the start of the month,
  deploy from Harel's PC: `docs/runbook.md` → "Deploy from a PC".
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
  touches the database. Every test passes on `main` (since 2026-11-14); a failing one blocks the
  deploy. A fresh test database holds only the inventory categories migrations add (one is a
  sheet one), not `DEFAULT_CATEGORIES`: a test needing a category creates it.
- Schema: edit `src/db/schema.ts`, `npm run db:generate`, rename the file to a readable name
  (and its `tag` in `drizzle/meta/_journal.json`), add `ALTER TABLE "x" ENABLE ROW LEVEL SECURITY;`
  for a new table, commit. Next migration: 0106. Migrations reach production before the code and
  a rollback runs old code on the new schema, so expand → contract: add columns/tables in one
  push; drop or rename one only in a later push, once no deployed code reads it.
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
  the bundle, `deploy/release.sh` extracts it to its own `releases/<sha>.<time>`, swaps
  `/opt/orbitparts/current`, restarts, and rolls back to the release that was live if `/api/ready`
  (database answers, the bundle's migrations applied) doesn't answer 200 in 90 s.
  `next.config.ts` has `output: "standalone"` and unoptimized images.
- Env vars live in `/opt/orbitparts/shared/.env` (systemd EnvironmentFile), not Vercel. A new one:
  `printf '%s' "$V" | ssh … "sudo -u orbit /opt/orbitparts/bin/set-env KEY"` (or `--generate`),
  then `sudo systemctl restart orbitparts`; Harel enters real secrets with
  `bash deploy/enter-secrets.sh 80.225.254.7 KEY…` (Git Bash). `NEXT_PUBLIC_*` are baked in at
  build time, so they are also GitHub secrets. Writing GitHub secrets is blocked for Claude: hand
  Harel the `gh secret set` command. The DB URL comes from `PRODUCTION_DIRECT_URL` via Actions →
  "Server env".
- Scheduled work: systemd timers on the VM (`vercel.json` is deleted). The old Vercel project still
  exists, paused until 2026-12-06; it should be disconnected before then or it deploys and runs
  keep-alive again next to the server. Daily `orbitparts-keep-alive.timer` (06:00 UTC) calls
  `/api/cron/keep-alive` (JSON backup, storage recount, prunes; 500 when a step failed);
  `orbitparts-backup.timer` (01:30 UTC) runs `deploy/backup.sh`: `pg_dump` 17 of the whole
  database → R2 `backups/sql/` (14 daily + 8 weekly). A new cron = a new timer in
  `deploy/setup.sh` (and on the VM); its route checks `cronAllowed(request)` (`src/lib/cron.ts`).
- Alerts: `/api/cron/health` answers 503 (database down or > 80%, migrations out of step, a
  backup > 26 h old) for an UptimeRobot monitor; `docs/runbook.md` → "Alerts", restore drill in
  "Restore the database".
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
  Manufacture document). The panel's Update system = Update BOM (commit makes Onshape's
  "V<next> BOM release" version, `onshapeName.ts`; "Update 3D views" checkbox) and Update CAD;
  a Basepart has Update Basepart. Both: check → Commit window (`cadDiff.ts`, `CadCommitWindow`) →
  commit (`cad.ts`, `cad_updates` with `model`: a new version or a sub-version "V12 v1"; pins
  `systems.model_ref` / `basepart_model_ref`). The CAD page shows the Final's or the Basepart's
  own tree. BOM pages (dashboard / system 3D, part pictures, part windows, Assembly) show the **BOM
  model** (`?model=bom`, `robot-model:<id>:bom`): each system at its current BOM version
  (`bomModelRef`), built with the Final by `buildModel` and sharing its plans, so Update CAD never
  shows on the BOM before Update BOM (Harel, 2026-11-18). A check whose only changes are same
  shapes in newer references commits them as a version of its own (`SAME_SHAPE`); a part whose new
  shape Onshape didn't send is listed, never taken unseen.
- Basepart and Final (2026-11-12): `systems.assembly_url` / `robots.main_assembly_url` are the
  **Final** (the only BOM source). The **Basepart** (`basepart_url`, `basepart_kind` partstudio |
  assembly, `basepart_studio_url`, `basepart_sketches`) is 3D and comments only: synced from the
  Onshape panel in a Part Studio (`&kind=partstudio` extension, `src/app/onshape/panel/`), then
  replaced by the assembly in the same document. Two models per robot: `buildRobotModel(…, kind)`
  (`robot-model:<id>` and `robot-model:<id>:basepart`), `?model=basepart` on `/api/robots/<id>/model`
  and on pages (Basepart | Final toggle, `ModelToggle.tsx`). Comments carry `model`.
- Geometry sketches: chosen in the panel (`GET /api/onshape/sketches`), fetched per Part Studio
  revision into R2 (`src/lib/onshape/sketches.ts`, format `src/lib/model/sketch.ts`), drawn by
  `src/components/viewer/sketches.ts` as face-less PartMeshes (Shift+H, isolate, measure; picked by
  screen distance in `picking.ts`). Hidden at first on the Final model.
- Onshape calls (plan/onshape-calls.md): every flow logs `onshape calls flow=… total=… <kind>=n`
  (`logCalls`). Answers about a Part Studio are kept under its revision (`src/lib/onshape/studioRevs.ts`:
  shape fingerprints, `partsList.ts`); the 3D model is planned per system and rebuilds only the
  ones that moved. Part / system / robot pictures are drawn in a CAD member's browser from the
  3D meshes (`src/components/viewer/pictures.ts`, `/api/robots/<id>/pictures`), never fetched
  from Onshape; `thumbnailRev` is "g" + a hash of the part's mesh.
- CAD (was "CAD Review"): `/robots/<id>/cad-review` is the whole robot on
  `src/components/review/ReviewScreen.tsx` (page wrapper `cad-review/CadReview.tsx`); a system's
  Isolate scopes it to that system (`?system=<id>`). The old `/cad-review/robot` and
  `/systems/<id>/cad-review` URLs redirect there. Comments with no system are on the whole robot. Comments: `src/lib/reviews/comments.ts` (anyone adds,
  CAD ticks, `members.isMentor` approves/rejects); version tree `src/lib/reviews/tree.ts` from the
  kept Onshape version list (`src/lib/versions/docVersions.ts`) and the BOM versions. No calls.
  Versions (plan/cad-versions.md, 2026-11-17): a tap on a tree version draws it from its kept
  snapshot (`model_snapshots`, `src/lib/model/snapshotStore.ts` / `snapshots.ts`, old ones built
  once on request), coloured by what changed since the version before (`versionDiff.ts`, in the
  browser); ⋮ = Compare (both drawn, slider fades them), Commit window, Delete version
  (`deleteVersion.ts`: OrbitParts only, a BOM version's part states fold into the next one). The
  whole robot's own versions: `robot_versions` (Create version).
  Comment rework and Design Reviews (plan/cad-design-review.md, 2026-11-18): Add comment floats
  over the 3D view (`Dialog` `floating`); a comment's `anchor` is the face / edge / corner picked
  (`src/lib/reviews/anchor.ts` signatures, found again on newer meshes; `viewer/anchors.ts`), its
  part tag frames it close up and picks it; 3D tags are author bubbles (`viewer/pins.ts`, popup
  `CommentBubble`) shown by the ☐ beside "Comments". Design Reviews: `design_reviews`,
  `src/lib/reviews/designReviews.ts` (admins start / finish, one open per robot, new comments in
  its scope join it), UI `src/components/review/DesignReviews.tsx`. Sandbox: `/dev/cad-review`.
  The whole 3D view as data (camera, hidden / isolated, section, edges, colours):
  `src/components/viewer/viewState.ts`, in the URL hash (`#v=`) and on each comment with its pin
  (`pins.ts`, assembly mm). The view cube's menu has Quality (`viewer/quality.ts`: pixel ratio,
  silhouettes, reflections; per device) and Edges instead of Onshape's render modes, and no Named
  views (Harel, 2026-11-19); `named_views` / `src/lib/reviews/namedViews.ts` are unused, to drop.
- 3D views (every viewer: CAD pages, BOM pages, part windows, Commit window): `ModelCanvas`
  (`src/components/dashboard/ModelCanvas.tsx`), tools in `src/components/review/ViewerToolbar.tsx`,
  picking / measuring maths in `src/lib/model/topology.ts`, `measure.ts`. Being reworked to work
  like Onshape: see "Work in progress" below.

## Work in progress

- **CAD 3D viewer rework** (2026-11-10/11): done. Mates (S8, 2026-11-18, plan/cad-mates.md): the
  model build reads Onshape's mates, groups and limits (`src/lib/model/mates.ts`), the browser moves
  them (`kinematics.ts`, `motion.ts`: left-drag a part; each mechanism's base is the part Onshape
  fixes; Move / explode by rigid set; no "Move along" item, Harel 2026-11-18). `plan/cad-3d-viewer.md` has what shipped (Progress table) and the briefs. The
  viewer lives in `src/components/viewer/` (one module per area; `SceneTools` is the API). Rule
  (Harel, 2026-11-11): the 3D view copies Onshape's assembly view unless he decided otherwise
  (kept: hover blue / picked orange, Shift+Y brings back the hidden part under the mouse, Space
  drops the newest pick, no parts list, no Hide others / Zoom to). Test 3D changes on `/dev/viewer`.
- **Design check** (plan/design-check.md, 2026-11-13): the CAD page's panel; runs in the CAD
  member's browser on the loaded model (`SceneTools.checkParts`, `showOverlap` for the red), maths
  in `src/lib/check/`, UI `src/components/check/`, saved in `design_checks`. Weight, frame
  perimeter, interference, connections, screw access, plates, printed parts, plate stress test,
  Gemini write-up; MCP `get_design_check`. Try it on `/dev/viewer`.
- Assembly page (`/robots/<id>/assembly`, plan/assembly-guides.md): sub-assemblies come from the
  part number (`src/lib/assembly/groups.ts`, 1690-26-421-01 → "42"), steps and ticks in
  `src/lib/assembly/steps.ts` (CAD writes with `instruct`, any team member ticks with `work`), page
  logic in `src/lib/assembly/view.ts`, UI in `src/components/assembly/`. `/dev/assembly` = sandbox.
- Scan anything (plan/item-recognition.md): Inventory's Scan on phones (`ScanButton.tsx`) reads
  barcodes as before; a gear in the aim ring gets a live green lock (`scan/lock.ts`) with its count
  and a Use button (teeth counter `src/lib/recognize/teeth.ts` in a worker, `public/teeth-worker.js`
  built by `npm run worker`). Capture shows `scan/ScanResults.tsx` as answers arrive: the AI's
  specs card (`/api/inventory/recognize`, Gemini free tier, `answer.ts`), shelf matches
  (`shelf.ts`), search results (stores by name + Google Lens through Serper, `/api/inventory/lens`,
  `lens.ts`, 3 credits a search, 60 a day). Nothing opens by itself; each result opens the add
  window. Raw answers and what the counter saw on `/inventory/scan-test`.
- Shop map (2026-11-14): places are `inventory_locations` rows: a zone (outline on the floor plan
  `config/workshopMap.ts`, colour, first-person picture in R2 `map/zones/`, `facing`) or a spot
  (`parent_id` = zone, `spot_x/y` its centre, `spot_w/h` its size, 0..1 of the picture, drawer / shelf /
  bin; its tag is the picture of the category most of its items are, 2026-11-17). Names stay for AI,
  search, history; the map never shows them. `src/components/map/` (`ShopMap` zoom → category icons
  → dive into the picture, `camera.ts` maths and the 2.5 s `findCam` flight, `FindButton` map icon,
  `SystemDrawerButton`), helpers `src/lib/inventory/places.ts`, edits `settings/mapActions.ts` +
  `components/settings/MapSettings.tsx` (Settings → Map), `systems.drawers` = a system's drawer
  per status. Sandbox `/dev/shop-map`. `GET /api/places` for pages without them.
  A zone with a 360° picture (`inventory_locations.panorama`, null = by shape, 3:1 or wider) is a
  first-person panorama (2026-11-20): `map/panorama.ts` maths (u / v of the picture, spots keep
  their 0..1 places), `PanoramaCanvas` (three.js cylinder, lazy), `PanoramaStage` (own gestures);
  in `ShopMap` the scene's cx / cy / s are where you look. A PC station whose room holds such a
  zone shows it in its window (`stationPanorama`, PCs at `inventory_devices.pano_x/y`).
- Box select (2026-11-17): every select mode (BOM, COTS, To Fab, Factory, Inventory) uses
  `useBoxSelect` (`src/components/ui/useBoxSelect.ts`): long press then drag, or a mouse drag;
  rows carry `[id^=part-]`, `[data-item]` or `[data-box-key]`. 3D: `picking.ts` (hold then drag on
  touch; `onBox` on `ModelCanvas` for Bulk edit).
- Files: `src/lib/storage/r2.ts`; backups and restore: `src/lib/storage/backup.ts`, `restore.ts`.
- Work the user needn't wait for: `afterResponse` (`src/lib/later.ts`).
- Installed app / offline (2026-11-13): `public/sw.js` (plain JS, production only, registered by
  `src/components/shell/OfflineSupport.tsx`, which also shows the offline bar). `/_next/static`
  from the device; pages network-first with a saved copy offline or after 8 s; `/api`, saves,
  sign-in and the panel never cached; any `/login` visit deletes saved pages. Bump its `VERSION`
  to drop its caches. Service workers don't run in the desktop app's browser pane: test with
  real Chrome.
- MCP: `src/lib/mcp/registry.ts` (`read` / `write`, preview → confirm token → apply) and one file
  per area in `src/lib/mcp/toolsets/`; `src/lib/mcp/tools.test.ts` counts the tools. Every tool
  names the capability its app button needs (`callTool` checks it on `effectiveMode(member)`; status
  rules via `statusChangeDeniedFor`), and writes say whether they're destructive.
- Paid / capped outside APIs (Serper web search and Lens, Gemini): `takeApiCall` (`src/lib/apiUsage.ts`,
  `api_usage` table) against `src/config/apiLimits.ts`. Web search runs only on "Search the web".
- Pages from links (product pages, pictures): `get()` in `src/lib/inventory/product.ts` (HTTPS only,
  private addresses refused after DNS, `src/lib/net/address.ts`). Don't `fetch` a user's URL directly.
- Drawings (plan/auto-drawings.md): engine `src/lib/drawing/` (`read.ts` geometry, `layout.ts` sheet,
  `svg.ts`), editor `src/components/drawing/DrawingEditor.tsx` (Onshape-style Dimension tool, hole
  menu, undo; every auto note and dimension retyped / hidden / moved). Edits live in
  `part_drawings.edits`, kept against the part (`Ref`: view key + view mm + hole) so they survive
  Regenerate. No hole positions on drawings (Harel, 2026-11-17). Sandbox `/dev/drawing`.
- To Fab: `src/components/fab/` (`fabModel.ts` rules, `BatchCard`, `MachineFilters`, Auto Layout in
  `BatchLayoutDialog` + `src/lib/fab/layout.ts`, `batchLayout.ts`).
- Data loaders for pages: `src/lib/data/`. The `(app)` layout must stay light: it runs on every
  navigation and every save.

## Gotchas

- Browsers run server actions one at a time: slow reads (search, popups) go in GET route handlers.
- A Drizzle query runs again each time it's awaited: wrap it in `Promise.resolve()` to share it.
- Supabase egress (5 GB/month free) ran out re-reading small tables on every render (2026-11-11).
  Whole-table / per-page reads go through `cached` / `cachedQuery` (`src/lib/data/cache.ts`): kept
  in the server's memory until a watched table's counter in `data_versions` moves (deferred
  triggers, migration 0083). A new table to watch = its triggers in a migration + `Watched`.
  Never cache inside a transaction (`exec === db` only) or anything with signed URLs.
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
