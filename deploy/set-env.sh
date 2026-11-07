#!/usr/bin/env bash
# Sets one variable in the server's /opt/orbitparts/shared/.env from stdin, so a secret never
# appears on a command line, in a log or in chat. Installed by deploy/setup.sh as
# /opt/orbitparts/bin/set-env; run as orbit (or with sudo -u orbit):
#   printf '%s' "$VALUE" | ssh orbit@<host> /opt/orbitparts/bin/set-env KEY
# With --generate instead of stdin it stores 48 random bytes (base64), for the app's own secrets.
# Restart afterwards: sudo systemctl restart orbitparts.
set -euo pipefail
KEY="${1:?usage: set-env KEY [--generate] < value}"
[[ "$KEY" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "bad key: $KEY" >&2; exit 1; }
FILE=/opt/orbitparts/shared/.env
if [ "${2:-}" = "--generate" ]; then
  VALUE="$(openssl rand -base64 48 | tr -d '\n')"
else
  VALUE="$(cat)"
fi
[ -n "$VALUE" ] || { echo "empty value for $KEY, nothing changed" >&2; exit 1; }
case "$VALUE" in *$'\n'*) echo "value for $KEY has a line break, nothing changed" >&2; exit 1 ;; esac
umask 077
touch "$FILE"
{ grep -v "^$KEY=" "$FILE" || true; printf '%s=%s\n' "$KEY" "$VALUE"; } > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
echo "$KEY set"
