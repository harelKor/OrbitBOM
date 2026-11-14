#!/usr/bin/env bash
# Switches the site to a release that GitHub Actions already built (.github/workflows/deploy.yml
# uploads Next's standalone bundle to /opt/orbitparts/incoming/<sha>.tar.gz), as user "orbit":
#   ssh orbit@<host> "bash -s <sha>" < deploy/release.sh
# Nothing is built here: the free VM is too small for `next build`. If the new release isn't
# ready (/api/ready: database answers, migrations applied), the site goes back to the one that
# was live and the workflow fails.
set -euo pipefail

SHA="${1:?usage: release.sh <commit sha>}"
ROOT=/opt/orbitparts
TARBALL="$ROOT/incoming/$SHA.tar.gz"
test -f "$TARBALL" || { echo "No uploaded bundle at $TARBALL." >&2; exit 1; }

# Every release gets its own folder (<sha>.<time>), so deploying the live commit again never
# deletes the running release, and the one to go back to is always the one that was live.
REL="$ROOT/releases/$SHA.$(date -u +%Y%m%d%H%M%S)"
[ -e "$REL" ] && REL="$REL.$$"
PREV="$(readlink -e "$ROOT/current" 2>/dev/null || true)"

trap 'rm -rf "$REL.new"' EXIT
mkdir -p "$REL.new"
tar -xzf "$TARBALL" -C "$REL.new"
test -f "$REL.new/server.js" || { echo "The bundle has no server.js." >&2; exit 1; }
mv -T "$REL.new" "$REL"
rm -f "$TARBALL"
# Uploads of runs that were cancelled before switching.
find "$ROOT/incoming" -maxdepth 1 -type f -mmin +1440 -delete 2>/dev/null || true

switch_to() {
  ln -sfn "$1" "$ROOT/current.new"
  mv -T "$ROOT/current.new" "$ROOT/current"
  sudo /usr/bin/systemctl restart orbitparts
}

ready() {
  for _ in $(seq 1 45); do
    if curl -fsS -o /dev/null -m 5 http://127.0.0.1:3000/api/ready; then return 0; fi
    sleep 2
  done
  return 1
}

switch_to "$REL"
if ! ready; then
  echo "New release did not answer on /api/ready:" >&2
  curl -sS -m 5 http://127.0.0.1:3000/api/ready >&2 || true
  echo >&2
  sudo /usr/bin/journalctl -u orbitparts -n 40 --no-pager >&2 || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    echo "Going back to $(basename "$PREV")." >&2
    switch_to "$PREV"
  fi
  exit 1
fi

# Keep the three newest releases for a quick manual rollback (point current at one, restart),
# never the live one or the one before it.
LIVE="$(readlink -e "$ROOT/current")"
ls -1dt "$ROOT"/releases/*/ | sed 's#/$##' | tail -n +4 | while read -r old; do
  [ "$old" = "$LIVE" ] || [ "$old" = "$PREV" ] || rm -rf "$old"
done
echo "Live: $(basename "$REL")"
