#!/bin/bash
# Crée le serveur dédié à l'envoi « leadmaker-envoi-1 » chez Hetzner (cx53 : 16 vCPU, 32 Go,
# ~29 €/mois), y installe les robots d'envoi (SEND_REPLICAS, 30 par défaut) et coupe les robots
# d'envoi du serveur principal. À lancer depuis le Mac, à la racine du dépôt :
#   ./workers/scripts/setup-send-server.sh
# Relançable : si le serveur existe déjà, il est réutilisé.
set -euo pipefail
cd "$(dirname "$0")/../.."

NAME=leadmaker-envoi-1
TYPE=${SEND_SERVER_TYPE:-cx53}
REPLICAS=${SEND_REPLICAS:-30}
MAIN=2.31.72.125
KEY=~/.ssh/leadmaker_hetzner
TOKEN=$(cat workers/.hetzner-token)
API=https://api.hetzner.cloud/v1
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"

api() { curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@"; }

IP=$(api "$API/servers?name=$NAME" | python3 -c "import sys,json;s=json.load(sys.stdin)['servers'];print(s[0]['public_net']['ipv4']['ip'] if s else '')")

if [ -z "$IP" ]; then
  # Hetzner manque souvent de place sur les petits modèles : on essaie plusieurs modèles et
  # plusieurs centres de données, et on réessaie pendant RETRY_MINUTES (30 par défaut).
  # cax41 = processeur ARM (l'image Playwright existe en ARM, Docker la construit sur place).
  CANDIDATES=${SEND_SERVER_TYPES:-"cx53 cx43 cax41"}
  LOCATIONS=${SEND_SERVER_LOCATIONS:-"fsn1 nbg1 hel1"}
  RETRY_MINUTES=${RETRY_MINUTES:-30}
  USER_DATA='#cloud-config
package_update: true
packages: [docker.io, docker-compose-v2, rsync]
runcmd:
  - systemctl enable --now docker
  - mkdir -p /opt/leadmaker/workers
'
  DEADLINE=$(( $(date +%s) + RETRY_MINUTES * 60 ))
  while [ -z "$IP" ]; do
    for T in $CANDIDATES; do
      for L in $LOCATIONS; do
        BODY=$(python3 -c "import json,sys;print(json.dumps({'name':'$NAME','server_type':'$T','image':'ubuntu-24.04','location':'$L','ssh_keys':[131980158],'labels':{'role':'envoi'},'user_data':sys.stdin.read()}))" <<<"$USER_DATA")
        OUT=$(api -X POST "$API/servers" -d "$BODY")
        IP=$(python3 -c "import sys,json;d=json.loads(sys.argv[1]);print(d['server']['public_net']['ipv4']['ip'] if 'server' in d else '')" "$OUT")
        if [ -n "$IP" ]; then echo "   serveur créé : $T à $L → $IP"; break; fi
        CODE=$(python3 -c "import sys,json;print(json.loads(sys.argv[1]).get('error',{}).get('code',''))" "$OUT")
        if [ "$CODE" != "resource_unavailable" ]; then echo "ERREUR $OUT"; exit 1; fi
        echo "   pas de place : $T à $L"
      done
      [ -n "$IP" ] && break
    done
    [ -n "$IP" ] && break
    if [ "$(date +%s)" -ge "$DEADLINE" ]; then echo "Aucun serveur disponible après $RETRY_MINUTES min. Réessayez plus tard, ou SEND_SERVER_TYPES=cpx62 (130 €/mois)."; exit 1; fi
    echo "   nouvel essai dans 60 s…"; sleep 60
  done
else
  echo "→ serveur $NAME déjà présent : $IP"
fi

echo "→ attente de SSH et de Docker (jusqu'à 5 min)…"
for i in $(seq 1 60); do
  if $SSH root@"$IP" 'command -v docker >/dev/null && docker compose version >/dev/null 2>&1 && test -d /opt/leadmaker/workers' 2>/dev/null; then break; fi
  sleep 5
done
$SSH root@"$IP" 'docker compose version' >/dev/null || { echo "Docker n'est pas prêt sur $IP"; exit 1; }

echo "→ copie des variables depuis le serveur principal (sans passage par un fichier local)…"
$SSH root@$MAIN 'cat /opt/leadmaker/workers/.env' | grep -vE '^SEND_REPLICAS=' | { cat; echo "SEND_REPLICAS=$REPLICAS"; } \
  | $SSH root@"$IP" 'cat > /opt/leadmaker/workers/.env && chmod 600 /opt/leadmaker/workers/.env'

echo "→ copie du code des robots…"
rsync -az -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" --exclude .venv --exclude logs --exclude data/bench \
  --exclude '.env*' --exclude '.hetzner*' --exclude '.dataimpulse' --exclude __pycache__ \
  workers/ root@"$IP":/opt/leadmaker/workers/

echo "→ lancement de $REPLICAS robots d'envoi sur ${IP}…"
$SSH root@"$IP" "cd /opt/leadmaker/workers && docker compose --profile send up -d --build send && sleep 20 && docker compose --profile send ps --format '{{.Service}} {{.State}}' | sort | uniq -c"

echo "→ arrêt des robots d'envoi du serveur principal (${MAIN})…"
$SSH root@$MAIN 'cd /opt/leadmaker/workers && docker compose --profile send stop send && docker compose --profile send rm -f send >/dev/null && docker compose ps --format "{{.Service}} {{.State}}" | sort | uniq -c'

echo "$IP" > workers/.send-server-ip
echo "Terminé. Serveur d'envoi : $IP (adresse notée dans workers/.send-server-ip)."
