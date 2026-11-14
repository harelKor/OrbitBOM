# Runbook

## Deploy

Pushing to `main` deploys to the team's own server, an Oracle Cloud Always Free VM in Mumbai
(Vercel Hobby's CPU allowance ran out and paused the site in November 2026). The "Deploy" GitHub
Action (`.github/workflows/deploy.yml`) is one ordered pipeline:

1. lint, typecheck and every test (database ones included, on a Postgres 17 service), then
   `next build` once;
2. upload the bundle to the server, then apply any migration production doesn't have yet
   (secret `PRODUCTION_DIRECT_URL`);
3. switch the server over (`deploy/release.sh`): a new folder per release, then wait for
   `/api/ready` (database answers, every migration the code needs applied). If it doesn't come up
   in 90 s, the release that was live comes back and the run fails.

A red check stops everything: nothing is migrated or deployed. A newer push cancels an older run's
checks, never a switch in progress. Pushes that only touch `plan/`, `docs/` or `*.md` don't run it.
Pull requests run the checks and build only. Check a run: `gh run list --workflow deploy.yml`.

Migrations go out before the code that needs them, and a rollback puts old code on the new
schema, so each migration must work with the code before it (expand → contract): add a column or
table in one push; drop or rename one only a push after no deployed code reads it.

## Bring something back

- **One robot, system, manual part or inventory item deleted in the last 30 days:** Settings →
  Recently deleted → Bring back (admins). It returns with its history, versions, stock moves and
  links.
- **A bad AI run:** AI logs → Revert change (or `undo_batch` from Claude).
- **A whole area gone wrong:** Settings → Backups → Restore (admins) puts the inventory, the BOM or
  both back the way a nightly backup has them. A copy of how things are now is saved first, so a
  restore can be undone the same way. Rows added since the backup stay unless "Also remove what
  was added since" is ticked.

Those restores use the app's JSON backups: `backups/orbitparts-YYYY-MM-DD.json.gz` in R2, saved
by the daily keep-alive (06:00 UTC), kept `BACKUP_DAYS` days (`src/config/storage.ts`). They hold
only the BOM and inventory tables, read as one snapshot. Download one from Settings to keep your
own copy.

The **whole database** (every table: members, history, versions, comments, assembly steps,
design checks, …) is in the server's nightly `pg_dump` (`deploy/backup.sh`, timer
`orbitparts-backup.timer`, 01:30 UTC): `backups/sql/daily/YYYY-MM-DD.sql.gz` (14 newest days) and
`backups/sql/weekly/` (Sunday's, 8 newest weeks), plus `YYYY-MM-DD-auth.sql.gz` with the sign-in
accounts when Supabase allows reading them. Run it now: `sudo systemctl start orbitparts-backup`;
what it did: `journalctl -u orbitparts-backup -n 20`. (It replaced the GitHub "Nightly backup"
workflow, which never worked.)

## Restore the database

**Drill (once a term, 10 minutes, on any PC with Docker):** proves the newest dump really restores.

1. Cloudflare → R2 → `orbitbom` → `backups/sql/daily/` → download the newest `.sql.gz`.
2. In PowerShell, from the download folder (Postgres 17, the same version as Supabase; wait a
   few seconds after the first line):

   ```
   docker run -d --name drill -e POSTGRES_PASSWORD=postgres postgres:17
   docker exec drill psql -U postgres -c "drop schema public cascade"
   docker cp 2026-11-14.sql.gz drill:/d.sql.gz
   docker exec drill sh -c "gzip -dc /d.sql.gz | psql -U postgres -q -v ON_ERROR_STOP=1"
   docker exec drill psql -U postgres -c "select (select count(*) from parts) parts, (select count(*) from members) members, (select count(*) from drizzle.__drizzle_migrations) migrations"
   docker rm -f drill
   ```

   The dump creates schema `public` itself, hence the drop. It passes when the restore prints no
   error and the counts look like the live site's.

**For real (Supabase project lost or broken):**

1. A new free Supabase project (Mumbai), Google sign-in set up again (`docs/setup.md` §1–2).
2. With its session pooler string (port 5432) as `$NEW`, from that Docker container or any psql
   17: `psql "$NEW" -c "drop schema public cascade"`, then
   `gzip -dc YYYY-MM-DD.sql.gz | psql "$NEW" -v ON_ERROR_STOP=1`. Then, if there is one,
   `gzip -dc YYYY-MM-DD-auth.sql.gz | psql "$NEW"` (otherwise members sign in again with Google
   and an admin re-links them).
3. Update the GitHub secrets `PRODUCTION_DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, run Actions → "Server env", then Actions → "Deploy"
   (the public values are baked into the build).

## Alerts

Two free UptimeRobot monitors email when something's wrong (Harel's account at uptimerobot.com,
free plan, nothing installed):

- `https://orbitparts.duckdns.org/login`: the site is up.
- `https://orbitparts.duckdns.org/api/cron/health`: answers 503 when the database is down or above
  80% of its 500 MB, migrations don't match the live code, or the newest SQL or JSON backup is
  older than 26 h. The answer names the failing checks (`{"ok":false,"failing":["sqlBackup"]}`)
  and nothing else. Details, on the server:
  `curl -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/health`
  (the old audit key now goes in an `X-Health-Key` header, not `?key=`).

Setting them up: uptimerobot.com → sign up (free) → **New monitor** → type **HTTP(s)**, URL as
above, interval 5 minutes, alert contact your email → **Create**. Do it for both URLs. The health
one is red until the first nightly backup has run.

Keep-alive answers 500 when any of its steps failed, so its timer shows in
`systemctl --failed`; so does the backup timer. Either way the health monitor turns red within a
day (a backup older than 26 h).

## Supabase paused

If the keep-alive cron was off for 7 days, Supabase pauses the project. Restore it from the
Supabase dashboard, then check the timer on the server: `systemctl list-timers orbitparts-keep-alive`.

## The server

- Set up once with `deploy/setup.sh` (Node, Caddy for HTTPS, the `orbitparts` service, the daily
  keep-alive and nightly backup timers, pg_dump 17 and rclone, user `orbit` that GitHub deploys
  as); running it again adds what's new and keeps the rest. Secrets: `/opt/orbitparts/shared/.env`
  (set one with `printf '%s' "$VALUE" | sudo -u orbit /opt/orbitparts/bin/set-env KEY`, then
  `sudo systemctl restart orbitparts`). A new server: `deploy/setup.sh`, then
  `bash deploy/enter-secrets.sh <ip>` from Git Bash (GitHub deploy secrets + each service's key,
  typed hidden), then Actions → "Server env" (database URL from `PRODUCTION_DIRECT_URL`) and
  Actions → "Deploy". `CRON_SECRET`, `MCP_SECRET` and `ONSHAPE_TOKEN_KEY` are just random
  (`set-env KEY --generate`); a new `ONSHAPE_TOKEN_KEY` makes everyone connect Onshape again.
- Address: https://orbitparts.duckdns.org (DuckDNS points it at the server's IP).
- Logs: `journalctl -u orbitparts -f`. Status: `systemctl status orbitparts caddy`.
- Roll back by hand: `ls -t /opt/orbitparts/releases` (three newest kept, named `<sha>.<time>`),
  `ln -sfn /opt/orbitparts/releases/<folder> /opt/orbitparts/current && sudo systemctl restart orbitparts`.
- Timers: `systemctl list-timers 'orbitparts-*'`. There is no Vercel any more (`vercel.json` is
  gone); the old Vercel project must stay disconnected, since it held production secrets and would
  run keep-alive a second time.
- Deploy again without a push: Actions → Deploy → Run workflow.

## Onshape calls

Profile shows the team's calls today and this year. Limits are in `src/config/onshapeBudget.ts`
(set `YEAR_STARTS` to the allowance's renewal date). Automatic thumbnails and previews stop first.
