#!/usr/bin/env bash
# One-time setup of the OrbitParts server: an Oracle Cloud Always Free Ubuntu 24.04 VM (Mumbai).
# Vercel Hobby's 4 Active-CPU-hours a month ran out and paused the site until the month reset;
# our own server has no CPU cap (Harel, 2026-11-06). Works on the 1 GB AMD micro VM as well as
# the Ampere A1 one: GitHub Actions builds, the server only runs the standalone bundle.
#
# Run from a PC that can SSH in as the image's default user (ubuntu), from the repo root:
#   ssh ubuntu@<ip> "sudo SET_ENV_SCRIPT=$(base64 -w0 deploy/set-env.sh) bash -s <site-host> '<deploy public key>'" < deploy/setup.sh
# It is safe to run again (to change the host name or the deploy key).
#
# What it sets up:
#   - Node 22 and Caddy (HTTPS from Let's Encrypt, reverse proxy to Next on 127.0.0.1:3000)
#   - user "orbit" that GitHub Actions deploys as (.github/workflows/deploy.yml, deploy/release.sh)
#   - /opt/orbitparts/{releases,incoming,shared}; current -> the live release
#   - 2 GB swap (the micro VM has 1 GB of memory)
#   - orbitparts.service (Next's standalone server.js) reading secrets from /opt/orbitparts/shared/.env
#   - orbitparts-keep-alive.timer: the daily /api/cron/keep-alive Vercel Cron used to call
#   - ports 80 and 443 open in the VM's own firewall (Oracle's Ubuntu image rejects them)
set -euo pipefail

SITE_HOST="${1:?usage: setup.sh <site-host> '<deploy public key>'}"
DEPLOY_KEY="${2:?usage: setup.sh <site-host> '<deploy public key>'}"
ROOT=/opt/orbitparts
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

# Node 22, the version CI builds with.
if ! node --version 2>/dev/null | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Caddy from its own apt repository.
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# Swap, so a busy moment on the 1 GB VM slows down instead of killing Node.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Deploy user: GitHub Actions logs in with this key and may only restart the app as root.
id orbit >/dev/null 2>&1 || useradd --create-home --shell /bin/bash orbit
install -d -m 700 -o orbit -g orbit /home/orbit/.ssh
printf '%s\n' "$DEPLOY_KEY" > /home/orbit/.ssh/authorized_keys
chown orbit:orbit /home/orbit/.ssh/authorized_keys
chmod 600 /home/orbit/.ssh/authorized_keys
cat > /etc/sudoers.d/orbitparts <<'EOF'
orbit ALL=(root) NOPASSWD: /usr/bin/systemctl restart orbitparts, /usr/bin/journalctl -u orbitparts -n 40 --no-pager
EOF
chmod 440 /etc/sudoers.d/orbitparts
visudo -cf /etc/sudoers.d/orbitparts

install -d -o orbit -g orbit "$ROOT" "$ROOT/releases" "$ROOT/incoming"
install -d -o root -g root "$ROOT/bin"
# deploy/set-env.sh, sent along by whoever runs this setup (see the usage line at the top).
if [ -n "${SET_ENV_SCRIPT:-}" ]; then printf '%s' "$SET_ENV_SCRIPT" | base64 -d > "$ROOT/bin/set-env"; chmod 755 "$ROOT/bin/set-env"; fi
install -d -m 700 -o orbit -g orbit "$ROOT/shared"
if [ ! -f "$ROOT/shared/.env" ]; then
  install -m 600 -o orbit -g orbit /dev/null "$ROOT/shared/.env"
fi

# The app. EnvironmentFile is read literally (no $ expansion), so passwords with $ stay intact.
cat > /etc/systemd/system/orbitparts.service <<EOF
[Unit]
Description=OrbitParts (Next.js)
After=network-online.target
Wants=network-online.target
ConditionPathExists=$ROOT/current

[Service]
User=orbit
WorkingDirectory=$ROOT/current
EnvironmentFile=$ROOT/shared/.env
Environment=NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=127.0.0.1 PORT=3000
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# Daily housekeeping, at the time the Vercel Cron ran (06:00 UTC).
cat > /etc/systemd/system/orbitparts-keep-alive.service <<EOF
[Unit]
Description=OrbitParts daily keep-alive, backup and clean-up

[Service]
Type=oneshot
User=orbit
EnvironmentFile=$ROOT/shared/.env
ExecStart=/usr/bin/curl -fsS -m 300 -H "Authorization: Bearer \${CRON_SECRET}" http://127.0.0.1:3000/api/cron/keep-alive
EOF
cat > /etc/systemd/system/orbitparts-keep-alive.timer <<'EOF'
[Unit]
Description=Run OrbitParts keep-alive daily

[Timer]
OnCalendar=*-*-* 06:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable orbitparts.service orbitparts-keep-alive.timer
systemctl start orbitparts-keep-alive.timer

# HTTPS in front of Next. Caddy passes X-Forwarded-Proto/Host on, so Next sees the https origin.
cat > /etc/caddy/Caddyfile <<EOF
$SITE_HOST {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy || systemctl restart caddy

# Oracle's Ubuntu image ends INPUT with a REJECT rule; let web traffic in ahead of it.
for port in 80 443; do
  if ! iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; then
    line=$(iptables -L INPUT --line-numbers | awk '/REJECT/ {print $1; exit}')
    if [ -n "$line" ]; then
      iptables -I INPUT "$line" -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    else
      iptables -A INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    fi
  fi
done
netfilter-persistent save

echo
echo "Server ready for $SITE_HOST."
echo "Next: put the production env vars in $ROOT/shared/.env, then run the Deploy workflow."
