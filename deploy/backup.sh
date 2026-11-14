#!/usr/bin/env bash
# Nightly full database backup (safety net, 2026-11-14): Supabase Free keeps no backups we can
# download, and the app's own JSON backup holds only the BOM and inventory. Installed by
# deploy/setup.sh as /opt/orbitparts/bin/backup and run by orbitparts-backup.timer as user orbit
# with /opt/orbitparts/shared/.env (DIRECT_URL = Supabase's session pooler, R2_* = the bucket).
# Run by hand: sudo systemctl start orbitparts-backup; see what it did: journalctl -u orbitparts-backup
#
#   backups/sql/daily/YYYY-MM-DD.sql.gz        public + drizzle schemas, plain SQL (psql restores it)
#   backups/sql/daily/YYYY-MM-DD-auth.sql.gz   auth.users / auth.identities rows, best effort
#   backups/sql/weekly/…                       Sunday's files again
# Keeps the 14 newest days and the 8 newest weeks (a few MB each, far inside R2's free 10 GB).
# Restore drill: docs/runbook.md → "Restore the database".
set -euo pipefail

: "${DIRECT_URL:?DIRECT_URL is not set in /opt/orbitparts/shared/.env}"
: "${R2_BUCKET:?R2_BUCKET is not set}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"
KEEP_DAILY=14
KEEP_WEEKLY=8
# pg_dump must be at least the server's major version: Supabase runs Postgres 17 and Ubuntu
# 24.04 ships 16, so setup.sh installs 17 from apt.postgresql.org. When Supabase moves to 18 the
# dump fails loudly (version mismatch) and /api/cron/health turns red: install postgresql-client-18.
PG_DUMP=/usr/lib/postgresql/17/bin/pg_dump

# rclone reads its R2 settings from the environment (no config file holding the key).
export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID:?}.r2.cloudflarestorage.com}"
DEST="r2:$R2_BUCKET/backups/sql"

DAY="$(date -u +%F)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

"$PG_DUMP" "$DIRECT_URL" --schema=public --schema=drizzle --no-owner --no-privileges | gzip -9 > "$TMP/$DAY.sql.gz"
# A dump cut short (connection dropped) has no closing line; never upload that as a good copy.
zcat "$TMP/$DAY.sql.gz" | tail -n 5 | grep -q "PostgreSQL database dump complete" || { echo "dump is incomplete" >&2; exit 1; }
echo "database: $(du -h "$TMP/$DAY.sql.gz" | cut -f1)"

# Who can sign in: worth having after losing the Supabase project, but Supabase may refuse
# reading parts of auth, so a failure here doesn't fail the backup.
if "$PG_DUMP" "$DIRECT_URL" --data-only --table=auth.users --table=auth.identities --no-owner --no-privileges | gzip -9 > "$TMP/$DAY-auth.sql.gz"; then
  echo "auth: $(du -h "$TMP/$DAY-auth.sql.gz" | cut -f1)"
else
  echo "auth rows could not be dumped (the database dump is fine)" >&2
  rm -f "$TMP/$DAY-auth.sql.gz"
fi

rclone copy "$TMP" "$DEST/daily/"
if [ "$(date -u +%u)" = 7 ]; then rclone copy "$TMP" "$DEST/weekly/"; fi

# Keep the newest N days in a folder; every file of an older day goes.
prune() {
  local dir="$1" keep="$2" day
  { rclone lsf --files-only "$DEST/$dir/" | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}' || true; } | sort -u | sort -r | tail -n +"$((keep + 1))" |
    while read -r day; do
      rclone delete "$DEST/$dir/" --include "$day*"
      echo "removed $dir/$day"
    done
}
prune daily "$KEEP_DAILY"
prune weekly "$KEEP_WEEKLY"
echo "backup saved: backups/sql/daily/$DAY.sql.gz"
