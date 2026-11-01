#!/bin/bash
# Mise à jour des robots sur le serveur Hetzner : copie du code puis
# reconstruction des robots qui tournent.
#   ./workers/scripts/deploy-robots.sh          → robots de recherche, estimation, préparation
#   ./workers/scripts/deploy-robots.sh --send   → les mêmes + le robot d'envoi (profil « send »)
# Sans --send, un robot d'envoi déjà lancé continue de tourner (docker ne l'arrête pas).
set -euo pipefail
cd "$(dirname "$0")/../.."
PROFILE=""
if [ "${1:-}" = "--send" ]; then PROFILE="--profile send"; fi
rsync -az -e "ssh -i ~/.ssh/leadmaker_hetzner" --exclude .venv --exclude logs --exclude data/bench \
  --exclude '.env*' --exclude '.hetzner*' --exclude '.dataimpulse' --exclude __pycache__ \
  workers/ root@2.31.72.125:/opt/leadmaker/workers/
ssh -i ~/.ssh/leadmaker_hetzner root@2.31.72.125 \
  "cd /opt/leadmaker/workers && docker compose $PROFILE up -d --build && sleep 15 && docker compose $PROFILE ps --format '{{.Service}} {{.State}}' | sort | uniq -c"
