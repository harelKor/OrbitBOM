#!/usr/bin/env bash
# Run once by Harel from Git Bash on his PC, from the repo root, after deploy/setup.sh:
#   bash deploy/enter-secrets.sh <server-ip>
# 1. Gives GitHub what the Deploy and Server env workflows need (deploy key, host, public
#    Supabase values).
# 2. Asks for each outside service's secret without showing it and sends it straight to the
#    server's /opt/orbitparts/shared/.env. Nothing is printed, logged or kept on this PC.
#    Press Enter on one to skip it.
# Vercel marks these "Sensitive" and never shows them again, so they come from each service.
set -euo pipefail
HOST="${1:?usage: bash deploy/enter-secrets.sh <server-ip>}"
ADMIN_KEY=~/.ssh/orbitparts_admin
DEPLOY_KEY=~/.ssh/orbitparts_deploy
GH="${GH:-$(command -v gh || echo "/c/Program Files/GitHub CLI/gh")}"

echo "== GitHub secrets"
"$GH" secret set DEPLOY_HOST --body "$HOST"
"$GH" secret set DEPLOY_SSH_KEY < "$DEPLOY_KEY"
ssh-keyscan -t ed25519,ecdsa,rsa "$HOST" 2>/dev/null | "$GH" secret set DEPLOY_KNOWN_HOSTS
"$GH" secret set NEXT_PUBLIC_SUPABASE_URL --body "$(ssh -i "$ADMIN_KEY" "ubuntu@$HOST" "sudo sed -n 's/^NEXT_PUBLIC_SUPABASE_URL=//p' /opt/orbitparts/shared/.env")"
"$GH" secret set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY --body "$(ssh -i "$ADMIN_KEY" "ubuntu@$HOST" "sudo sed -n 's/^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=//p' /opt/orbitparts/shared/.env")"

echo
echo "== Server secrets (typing is hidden; Enter skips)"
ask() {
  local key="$1" where="$2" value
  echo
  echo "$key  ($where)"
  read -rsp "  paste, then Enter: " value
  echo
  if [ -z "$value" ]; then echo "  skipped"; return; fi
  printf '%s' "$value" | ssh -i "$ADMIN_KEY" "ubuntu@$HOST" "sudo -u orbit /opt/orbitparts/bin/set-env $key"
}
ask R2_ACCOUNT_ID          "Cloudflare → R2 → Overview, right side: Account ID"
ask R2_ACCESS_KEY_ID       "Cloudflare → R2 → Manage API tokens → Create: Object Read & Write, bucket orbitbom"
ask R2_SECRET_ACCESS_KEY   "same new R2 token: Secret Access Key"
ask ONSHAPE_CLIENT_ID      "dev-portal.onshape.com → OAuth applications → the OrbitParts app"
ask ONSHAPE_CLIENT_SECRET  "same app; if it can't be shown again, reset/regenerate it there"
ask SERPER_API_KEY         "serper.dev → Dashboard → API key"
ask ADMIN_EMAILS           "optional: emails made admin on first sign-in, comma-separated"

ssh -i "$ADMIN_KEY" "ubuntu@$HOST" "sudo systemctl restart orbitparts" || true
echo
echo "Done. Variables now on the server:"
ssh -i "$ADMIN_KEY" "ubuntu@$HOST" "sudo cut -d= -f1 /opt/orbitparts/shared/.env"
