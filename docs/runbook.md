# Runbook

## Deploy

Merging to `main` deploys to Vercel. New migrations in `drizzle/` are applied by hand before or
right after the deploy: `npm run db:migrate` with `DIRECT_URL` set to production.

## Restore a backup

The nightly backup is `orbitbom.sql` in the private backup repo; git history has every night.

1. Check out the commit for the night you want.
2. Into a fresh Supabase project (or after a reset): `psql "$DIRECT_URL" -f orbitbom.sql`
3. Point `DATABASE_URL` / `DIRECT_URL` in Vercel at it and redeploy.

Test this once before the season: restore into a scratch Supabase project and sign in.

## Supabase paused

If the keep-alive cron was off for 7 days, Supabase pauses the project. Restore it from the
Supabase dashboard, then check the cron under Vercel → Settings → Cron Jobs.
