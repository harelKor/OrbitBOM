@AGENTS.md

# OrbitBOM (shown to users as OrbitParts)

FRC team 1690's BOM, To Fab and inventory app, modelled on FRCBOM and linked to Onshape. Owner:
Harel. Live: https://orbit-bom.vercel.app. Next.js 16 (App Router, Cache Components off,
`src/proxy.ts` instead of middleware), React 19, Drizzle + node-postgres on Supabase Free
(Postgres + Google sign-in, Mumbai), Cloudflare R2 for files, Vercel Hobby (`bom1`), vitest.
Everything must stay on free tiers. Members also drive it from their own Claude through the MCP
server (`/api/mcp/<token>`).

## Working with Harel

- Ship straight to `main`: commit, push, Vercel deploys. No branches or PRs unless he asks.
  `.github/workflows/migrate.yml` applies new migrations on push; when deployed code needs a new
  table on every request, wait for that run before calling it done.
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
  for a new table, commit. Next migration: 0072.
- Local site: README "Local development" (local Supabase in Docker, "Dev sign-in" button; Onshape
  and R2 deliberately unset). Never point local dev at production.
- On Harel's Windows PC, Docker and `gh` aren't on the Bash PATH: run them from PowerShell, or
  `"/c/Program Files/GitHub CLI/gh"`.

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
- Next 16 `error.tsx` gets `retry`, not `reset`. Read `node_modules/next/dist/docs/` before using
  an API you haven't checked.
- Dates in client components: `LocalTime` (`src/components/ui/LocalTime.tsx`), or hydration breaks.
- UI: tokens and utilities in `src/app/globals.css`, primitives in `src/components/ui/`, windows in
  `src/components/Dialog.tsx`. Touch targets ≥ 36px on `pointer-coarse`, `tabular-nums` for numbers,
  `active:scale-[0.98]` on pressables. Test at phone width; the shop uses phones.
- Don't run Prettier: the repo isn't formatted with it (long lines are fine).
- Comments say why, in plain words; product decisions carry "(Harel, YYYY-MM-DD)".
- Design notes behind the code: `plan/` (historical; the code wins when they disagree).
