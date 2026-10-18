@AGENTS.md

# OrbitBOM conventions

- The BOM, inventory and Onshape behaviour copy FRCBOM; don't redesign them.
- Fixed lists live in `src/config/`; there is no settings UI.
- Status always comes from `computeStatus` in `src/lib/status.ts`.
- Database access happens only on the server through Drizzle (`src/db`). RLS is on with no
  policies, so the browser's Supabase key can't read tables.
- Onshape tokens and keys never reach the browser. Never call Onshape while rendering a page.
- Schema changes: edit `src/db/schema.ts`, run `npm run db:generate`, commit the migration.
