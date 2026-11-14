#!/usr/bin/env bash
# Run on a fresh Ubuntu 22.04/24.04 VPS, from inside the unzipped project folder:
#   sudo bash deploy/install.sh kassa.ceylongames.com 'your-admin-password'
set -euo pipefail
DOMAIN="${1:?usage: install.sh <domain> <admin-password>}"; PASS="${2:?usage: install.sh <domain> <admin-password>}"
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sh; fi
cd "$(dirname "$0")"
printf 'DOMAIN=%s\nKASSA_ADMIN_PASSWORD=%s\n' "$DOMAIN" "$PASS" > .env
docker compose up -d --build
echo "Done. Make sure the DNS A record for $DOMAIN points to this server, then open https://$DOMAIN"
