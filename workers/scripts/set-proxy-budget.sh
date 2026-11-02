#!/bin/bash
# Change le plafond quotidien du proxy de la recherche (PROXY_DAILY_BUDGET_GB, en Go par jour, heure de
# Paris ; 0 = sans plafond) sur le serveur principal, puis met à jour les robots avec contrôle avant
# bascule (deploy-robots.sh).
#   ./workers/scripts/set-proxy-budget.sh 6
# L'ancien réglage est gardé dans /opt/leadmaker/workers/.env.bak-budget sur le serveur.
set -euo pipefail
cd "$(dirname "$0")/../.."
GB=${1:-}
if ! [[ "$GB" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "Indiquez le plafond en Go par jour, par exemple : ./workers/scripts/set-proxy-budget.sh 6"
  exit 1
fi
ssh -i ~/.ssh/leadmaker_hetzner root@2.31.72.125 "cd /opt/leadmaker/workers && cp .env .env.bak-budget && grep -v '^PROXY_DAILY_BUDGET_GB=' .env > .env.new && printf 'PROXY_DAILY_BUDGET_GB=%s\n' '$GB' >> .env.new && mv .env.new .env && chmod 600 .env"
echo "→ plafond du proxy : $GB Go par jour"
./workers/scripts/deploy-robots.sh
