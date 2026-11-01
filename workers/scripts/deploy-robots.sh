#!/bin/bash
# Mise à jour des robots sur les serveurs Hetzner : copie du code puis reconstruction.
#   ./workers/scripts/deploy-robots.sh          → serveur principal (recherche, estimation, préparation)
#   ./workers/scripts/deploy-robots.sh --send   → serveur d'envoi (adresse dans workers/.send-server-ip)
#   ./workers/scripts/deploy-robots.sh --all    → les deux
set -euo pipefail
cd "$(dirname "$0")/../.."
KEY=~/.ssh/leadmaker_hetzner
MAIN=2.31.72.125
MODE=${1:-main}

sync() {
  rsync -az -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" --exclude .venv --exclude logs --exclude data/bench \
    --exclude '.env*' --exclude '.hetzner*' --exclude '.dataimpulse' --exclude __pycache__ \
    workers/ root@"$1":/opt/leadmaker/workers/
}

if [ "$MODE" = main ] || [ "$MODE" = --all ]; then
  echo "→ serveur principal $MAIN"
  sync "$MAIN"
  ssh -i $KEY root@$MAIN 'cd /opt/leadmaker/workers && docker compose up -d --build && sleep 15 && docker compose ps --format "{{.Service}} {{.State}}" | sort | uniq -c'
fi

if [ "$MODE" = --send ] || [ "$MODE" = --all ]; then
  SEND_IP=$(cat workers/.send-server-ip 2>/dev/null || true)
  [ -n "$SEND_IP" ] || { echo "Pas de serveur d'envoi : lancez d'abord workers/scripts/setup-send-server.sh"; exit 1; }
  echo "→ serveur d'envoi $SEND_IP"
  sync "$SEND_IP"
  ssh -i $KEY root@"$SEND_IP" 'cd /opt/leadmaker/workers && docker compose --profile send up -d --build send && sleep 15 && docker compose --profile send ps --format "{{.Service}} {{.State}}" | sort | uniq -c'
fi
