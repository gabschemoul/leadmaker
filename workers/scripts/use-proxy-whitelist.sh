#!/bin/bash
# Passe la recherche Google Maps sur le proxy SANS identifiant (adresse du serveur autorisée chez
# DataImpulse, « Whitelist IP »). Le cache du navigateur remarche : ~10 fois moins de Mo par recherche.
#   ./workers/scripts/use-proxy-whitelist.sh           → bascule (testée avant, sinon rien ne change)
#   ./workers/scripts/use-proxy-whitelist.sh --undo    → revient au proxy avec identifiant
set -euo pipefail
cd "$(dirname "$0")/../.."
KEY=~/.ssh/leadmaker_hetzner
MAIN=2.31.72.125
GATEWAY=http://gw.dataimpulse.com:823
SSH=(ssh -i "$KEY" root@"$MAIN")

if [ "${1:-}" = --undo ]; then
  "${SSH[@]}" 'cd /opt/leadmaker/workers && [ -f .env.bak-whitelist ] && cp .env.bak-whitelist .env && chmod 600 .env'
  exec ./workers/scripts/deploy-robots.sh
fi

echo "→ le proxy accepte-t-il le serveur sans identifiant ?"
CODE=$("${SSH[@]}" "curl -s -o /dev/null -w '%{http_code}' --max-time 20 -x $GATEWAY https://www.google.com/maps ; true")
if [ "$CODE" != "200" ]; then
  echo "Non (réponse $CODE) : l'adresse $MAIN n'est pas autorisée chez DataImpulse. Rien n'a été changé."
  exit 1
fi
echo "→ oui. Réglage du serveur (ancien réglage gardé pour --undo)"
"${SSH[@]}" "cd /opt/leadmaker/workers && { [ -f .env.bak-whitelist ] || cp .env .env.bak-whitelist; } && grep -v '^PROXY_URL=' .env > .env.new && printf 'PROXY_URL=%s\n' '$GATEWAY' >> .env.new && mv .env.new .env && chmod 600 .env"
if ! ./workers/scripts/deploy-robots.sh; then
  echo "→ test raté : retour à l'ancien réglage"
  "${SSH[@]}" 'cd /opt/leadmaker/workers && cp .env.bak-whitelist .env && chmod 600 .env'
  exit 1
fi
echo "✓ Recherche Google Maps sur le proxy sans identifiant."
