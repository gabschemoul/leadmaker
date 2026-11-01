#!/bin/bash
# Fait passer les robots des deux serveurs sur le pooler Supabase en mode transaction (port 6543) :
# des dizaines de robots se partagent alors quelques connexions Postgres au lieu d'une chacun.
# Modifie DATABASE_URL dans le .env de chaque serveur (port 5432 → 6543), puis redéploie.
set -euo pipefail
cd "$(dirname "$0")/../.."
KEY=~/.ssh/leadmaker_hetzner
for IP in 2.31.72.125 $(cat workers/.send-server-ip 2>/dev/null); do
  echo "→ $IP"
  ssh -i $KEY root@"$IP" 'cd /opt/leadmaker/workers && cp .env .env.bak-5432 && sed -i -E "s#(pooler\.supabase\.com):5432/#\1:6543/#" .env && grep -oE "pooler\.supabase\.com:[0-9]+" .env'
done
./workers/scripts/deploy-robots.sh --all
