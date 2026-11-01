#!/bin/bash
# Change le proxy de la recherche Google Maps (PROXY_URL) sur le serveur principal, à partir du
# presse-papiers, puis relance les robots. Les identifiants ne s'affichent nulle part.
# 1. Chez DataImpulse, copiez l'adresse complète du forfait voulu, de la forme
#    http://IDENTIFIANT:MOT_DE_PASSE@gw.dataimpulse.com:823
# 2. Lancez : ./workers/scripts/set-proxy.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
URL=$(pbpaste | tr -d '[:space:]')
if ! [[ "$URL" =~ ^https?://[^:@/]+:[^@/]+@[^:/]+:[0-9]+/?$ ]]; then
  echo "Le presse-papiers ne contient pas une adresse de proxy du type http://identifiant:motdepasse@hote:port"
  exit 1
fi
HOST=$(echo "$URL" | sed -E 's#^https?://[^@]+@##')
echo "→ proxy de recherche : ***@$HOST"
ssh -i ~/.ssh/leadmaker_hetzner root@2.31.72.125 "cd /opt/leadmaker/workers && cp .env .env.bak-proxy && grep -v '^PROXY_URL=' .env > .env.new && printf 'PROXY_URL=%s\n' '$URL' >> .env.new && mv .env.new .env && chmod 600 .env"
./workers/scripts/deploy-robots.sh --all
