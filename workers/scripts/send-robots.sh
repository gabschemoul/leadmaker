#!/bin/bash
# Règle le nombre de robots d'envoi sur le serveur d'envoi, sans reconstruire.
#   ./workers/scripts/send-robots.sh 8     → 8 robots
#   ./workers/scripts/send-robots.sh 0     → envoi coupé
set -euo pipefail
cd "$(dirname "$0")/../.."
N=${1:?nombre de robots}
IP=$(workers/scripts/send-server-ip.sh)
ssh -i ~/.ssh/leadmaker_hetzner -o StrictHostKeyChecking=accept-new root@"$IP" "cd /opt/leadmaker/workers && docker compose --profile send up -d --no-build --scale send=$N send && docker compose --profile send ps --format '{{.State}}' | sort | uniq -c"
