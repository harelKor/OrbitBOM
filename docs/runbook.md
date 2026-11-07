# Runbook

## Deploy

Pushing to `main` deploys to the team's own server, an Oracle Cloud Always Free VM in Mumbai
(Vercel Hobby's CPU allowance ran out and paused the site in November 2026). The "Deploy" GitHub
Action builds Next's standalone bundle, uploads it and switches over (`deploy/release.sh`); if the
new release doesn't answer, the old one stays live and the run fails. New migrations in `drizzle/` are applied to production by
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
into a fresh Supabase project, then point `DATABASE_URL` / `DIRECT_URL` in the server's `/opt/orbitparts/shared/.env` at it.

## Supabase paused

If the keep-alive cron was off for 7 days, Supabase pauses the project. Restore it from the
Supabase dashboard, then check the timer on the server: `systemctl list-timers orbitparts-keep-alive`.

## The server

- Set up once with `deploy/setup.sh` (Node, Caddy for HTTPS, the `orbitparts` service, the daily
  keep-alive timer, user `orbit` that GitHub deploys as). Secrets: `/opt/orbitparts/shared/.env`
  (set one with `printf '%s' "$VALUE" | sudo -u orbit /opt/orbitparts/bin/set-env KEY`, then
  `sudo systemctl restart orbitparts`). A new server: `deploy/setup.sh`, then
  `bash deploy/enter-secrets.sh <ip>` from Git Bash (GitHub deploy secrets + each service's key,
  typed hidden), then Actions → "Server env" (database URL from `PRODUCTION_DIRECT_URL`) and
  Actions → "Deploy". `CRON_SECRET`, `MCP_SECRET` and `ONSHAPE_TOKEN_KEY` are just random
  (`set-env KEY --generate`); a new `ONSHAPE_TOKEN_KEY` makes everyone connect Onshape again.
- Address: https://orbitparts.duckdns.org (DuckDNS points it at the server's IP).
- Logs: `journalctl -u orbitparts -f`. Status: `systemctl status orbitparts caddy`.
- Roll back by hand: `ls -t /opt/orbitparts/releases` (three newest kept),
  `ln -sfn /opt/orbitparts/releases/<sha> /opt/orbitparts/current && sudo systemctl restart orbitparts`.
- Deploy again without a push: Actions → Deploy → Run workflow.

## Onshape calls

Profile shows the team's calls today and this year. Limits are in `src/config/onshapeBudget.ts`
(set `YEAR_STARTS` to the allowance's renewal date). Automatic thumbnails and previews stop first.
