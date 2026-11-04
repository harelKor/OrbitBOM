# Runbook

## Deploy

Pushing to `main` deploys to Vercel. New migrations in `drizzle/` are applied to production by
the "Migrate database" GitHub Action on the same push (secret `PRODUCTION_DIRECT_URL`); check
that run when a change adds a table.

## Bring something back

- **One robot, system, manual part or inventory item deleted in the last 30 days:** Settings →
  Recently deleted → Bring back (admins). It returns with its history, versions, stock moves and
  links.
- **A bad AI run:** AI logs → Revert change (or `undo_batch` from Claude).
- **A whole area gone wrong:** Settings → Backups → Restore (admins) puts the inventory, the BOM or
  both back the way a nightly backup has them. A copy of how things are now is saved first, so a
  restore can be undone the same way. Rows added since the backup stay unless "Also remove what
  was added since" is ticked.

The nightly backups are JSON files in R2 (`backups/`), kept `BACKUP_DAYS` days
(`src/config/storage.ts`); download one from Settings to keep your own copy.

The GitHub "Nightly backup" workflow (a full `pg_dump` into a private repo) has been failing since
it was set up: its checkout of the backup repo answers Not Found, so `BACKUP_REPO` or
`BACKUP_REPO_TOKEN` is wrong. Once fixed, a full restore is `psql "$DIRECT_URL" -f orbitbom.sql`
into a fresh Supabase project, then point `DATABASE_URL` / `DIRECT_URL` in Vercel at it.

## Supabase paused

If the keep-alive cron was off for 7 days, Supabase pauses the project. Restore it from the
Supabase dashboard, then check the cron under Vercel → Settings → Cron Jobs.

## Onshape calls

Profile shows the team's calls today and this year. Limits are in `src/config/onshapeBudget.ts`
(set `YEAR_STARTS` to the allowance's renewal date). Automatic thumbnails and previews stop first.
