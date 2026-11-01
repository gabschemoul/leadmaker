#!/bin/bash
# Mise à jour des robots sur le serveur Hetzner : copie du code puis
# reconstruction des robots qui tournent. Le robot d'envoi (profil « send »)
# n'est jamais lancé par ce script.
set -euo pipefail
cd "$(dirname "$0")/../.."
rsync -az -e "ssh -i ~/.ssh/leadmaker_hetzner" --exclude .venv --exclude logs --exclude data/bench \
  --exclude '.env*' --exclude '.hetzner*' --exclude '.dataimpulse' --exclude __pycache__ \
  workers/ root@2.31.72.125:/opt/leadmaker/workers/
ssh -i ~/.ssh/leadmaker_hetzner root@2.31.72.125 \
  'cd /opt/leadmaker/workers && docker compose up -d --build && sleep 15 && docker compose ps --format "{{.Service}} {{.State}}" | sort | uniq -c'
