#!/usr/bin/env bash
# Switches the site to a release that GitHub Actions already built (.github/workflows/deploy.yml
# uploads Next's standalone bundle to /opt/orbitparts/incoming/<sha>.tar.gz), as user "orbit":
#   ssh orbit@<host> "bash -s <sha>" < deploy/release.sh
# Nothing is built here: the free VM is too small for `next build`. If the new release doesn't
# answer, the site goes back to the old one and the workflow fails.
set -euo pipefail

SHA="${1:?usage: release.sh <commit sha>}"
ROOT=/opt/orbitparts
REL="$ROOT/releases/$SHA"
PREV="$(readlink -e "$ROOT/current" 2>/dev/null || true)"
[ "$PREV" = "$REL" ] && PREV=""

rm -rf "$REL"
mkdir -p "$REL"
tar -xzf "$ROOT/incoming/$SHA.tar.gz" -C "$REL"
rm -f "$ROOT/incoming/$SHA.tar.gz"
test -f "$REL/server.js"

switch_to() {
  ln -sfn "$1" "$ROOT/current.new"
  mv -T "$ROOT/current.new" "$ROOT/current"
  sudo /usr/bin/systemctl restart orbitparts
}

healthy() {
  for _ in $(seq 1 45); do
    if curl -fsS -o /dev/null -m 5 http://127.0.0.1:3000/login; then return 0; fi
    sleep 2
  done
  return 1
}

switch_to "$REL"
if ! healthy; then
  echo "New release did not answer on /login." >&2
  sudo /usr/bin/journalctl -u orbitparts -n 40 --no-pager >&2 || true
  if [ -n "$PREV" ]; then
    echo "Going back to $(basename "$PREV")." >&2
    switch_to "$PREV"
  fi
  exit 1
fi

# Keep the three newest releases for a quick manual rollback (point current at one, restart).
ls -1dt "$ROOT"/releases/* | tail -n +4 | xargs -r rm -rf
echo "Live: $SHA"
