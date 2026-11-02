#!/bin/bash
# Mise à jour des robots sur les serveurs Hetzner, AVEC CONTRÔLE AVANT BASCULE.
#   ./workers/scripts/deploy-robots.sh               → serveur principal (recherche, estimation, préparation, surveillant)
#   ./workers/scripts/deploy-robots.sh --send        → serveur d'envoi (adresse dans workers/.send-server-ip)
#   ./workers/scripts/deploy-robots.sh --all         → les deux
#   ./workers/scripts/deploy-robots.sh --rollback    → remet la version précédente (serveur principal)
#   ./workers/scripts/deploy-robots.sh --rollback-send
#
# Déroulé : la nouvelle version est copiée À CÔTÉ de celle qui tourne, construite, puis testée en vrai
# (base, recherche Google Maps par le proxy, visite d'un site : leadmaker_workers/selftest.py).
# Si le test échoue, RIEN ne change : les robots continuent avec l'ancienne version.
# Si le test réussit, l'ancienne version est gardée de côté (pour --rollback) et les robots basculent.
set -euo pipefail
cd "$(dirname "$0")/../.."
KEY=~/.ssh/leadmaker_hetzner
MAIN=2.31.72.125
MODE=${1:-main}
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new)
EXCLUDES=(--exclude .venv --exclude logs --exclude data/bench --exclude '.env*' --exclude '.hetzner*'
          --exclude '.dataimpulse' --exclude '.send-server-ip' --exclude __pycache__)

send_ip() {
  local ip
  ip=$(cat workers/.send-server-ip 2>/dev/null || true)
  [ -n "$ip" ] || { echo "Pas de serveur d'envoi : lancez d'abord workers/scripts/setup-send-server.sh"; exit 1; }
  echo "$ip"
}

# deploy <ip> <arguments du test> <commande compose de bascule>
# (ssh recolle les arguments en une seule ligne : ils sont protégés par printf %q)
deploy() {
  local ip=$1 test_args=$2 up_cmd=$3
  echo "→ $ip : copie de la nouvelle version (à côté de celle qui tourne)"
  "${SSH[@]}" root@"$ip" 'mkdir -p /opt/leadmaker/workers-next && [ -e /opt/leadmaker/workers-next/docker-compose.yml ] || cp -a /opt/leadmaker/workers/. /opt/leadmaker/workers-next/'
  rsync -az --delete "${EXCLUDES[@]}" -e "${SSH[*]}" workers/ root@"$ip":/opt/leadmaker/workers-next/

  echo "→ $ip : construction et test de la nouvelle version (1 à 3 minutes)"
  if ! "${SSH[@]}" root@"$ip" bash -s -- "$(printf '%q' "$test_args")" <<'REMOTE'
set -euo pipefail
cd /opt/leadmaker/workers-next
cp ../workers/.env .env
export ROBOT_IMAGE_TAG=candidate
docker compose -p lmcheck build -q discovery
timeout 240 docker compose -p lmcheck run --rm --no-deps -T discovery python -m leadmaker_workers.selftest ${1:-}
REMOTE
  then
    echo ""
    echo "✗ MISE À JOUR ANNULÉE sur $ip : la nouvelle version ne passe pas le test."
    echo "  Les robots continuent avec l'ancienne version, rien n'a changé pour les campagnes."
    exit 1
  fi

  echo "→ $ip : test réussi, bascule des robots"
  "${SSH[@]}" root@"$ip" bash -s -- "$(printf '%q' "$up_cmd")" <<'REMOTE'
set -euo pipefail
cd /opt/leadmaker
docker image inspect leadmaker-worker:latest >/dev/null 2>&1 && docker tag leadmaker-worker:latest leadmaker-worker:previous
rm -rf workers-previous && cp -a workers workers-previous
rsync -a --exclude .env --exclude logs --exclude data/bench workers-next/ workers/
cd workers
eval "${1:-}"
sleep 20
docker compose ps --format '{{.Service}} {{.State}}' | sort | uniq -c
if docker compose ps --format '{{.State}}' | grep -q restarting; then
  echo "ATTENTION : un robot ne tourne pas. Relancer avec --rollback si ça persiste."
  exit 1
fi
REMOTE
  echo "✓ $ip à jour."
}

rollback() {
  local ip=$1 up_cmd=$2
  echo "→ $ip : retour à la version précédente"
  "${SSH[@]}" root@"$ip" bash -s -- "$(printf '%q' "$up_cmd")" <<'REMOTE'
set -euo pipefail
cd /opt/leadmaker
[ -d workers-previous ] || { echo "Aucune version précédente gardée sur ce serveur."; exit 1; }
rsync -a --exclude .env --exclude logs --exclude data/bench workers-previous/ workers/
cd workers
eval "${1:-}"
sleep 20
docker compose ps --format '{{.Service}} {{.State}}' | sort | uniq -c
REMOTE
}

MAIN_UP='docker compose up -d --build'
SEND_UP='docker compose --profile send up -d --build send watch-send'

case "$MODE" in
  main) deploy "$MAIN" "" "$MAIN_UP" ;;
  --send) deploy "$(send_ip)" "--sites" "$SEND_UP" ;;
  --all) deploy "$MAIN" "" "$MAIN_UP"; deploy "$(send_ip)" "--sites" "$SEND_UP" ;;
  --rollback) rollback "$MAIN" "$MAIN_UP" ;;
  --rollback-send) rollback "$(send_ip)" "$SEND_UP" ;;
  *) sed -n 2,7p "$0"; exit 1 ;;
esac
