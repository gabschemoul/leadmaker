#!/bin/zsh
# Robot « ordinateur dédié » : fait sur ce Mac les recherches Google Maps des campagnes marquées
# « Rechercher sur l'ordinateur dédié » (page de la campagne), par la connexion internet du Mac, SANS proxy
# (rien à payer). Il travaille sur la VRAIE base (prospectigo.com) et ne prend que ces campagnes-là.
#
#   ./workers/scripts/run-mac-discovery.sh          → lance 4 robots (l'ancien outil tournait à 4 sans blocage Google)
#   ./workers/scripts/run-mac-discovery.sh start 2  → 2 robots ; relancer « start » complète les robots manquants
#   ./workers/scripts/run-mac-discovery.sh status   → robots en marche + dernières lignes du journal
#   ./workers/scripts/run-mac-discovery.sh stop     → arrête les robots (chacun finit sa fiche en cours)
#
# Le Mac ne se met pas en veille tant qu'un robot tourne (caffeinate). Captcha Google : le robot se met
# en pause 30 min, puis 1 h, 2 h, 4 h, et la recherche reprend toute seule. Journal : workers/logs/mac-discovery-*.log
set -eu
cd "$(dirname "$0")/.."

ACTION=${1:-start}
COUNT=${2:-4}
# Marque des robots de ce script dans la liste des processus (argument ignoré par le robot)
# Ligne de commande d'un robot : elle COMMENCE par le Python du robot (exclut Terminal, scripts, caffeinate)
PATTERN='^[^ ]*[Pp]ython[0-9.]* -m leadmaker_workers[.]main mac-discovery'
robots() { pgrep -lf -- "$PATTERN" 2>/dev/null | grep -v caffeinate | cut -d' ' -f1 || true; }
# robot n° i en marche ? (chaque robot porte son numéro : « mac-discovery-3 »)
robot_up() { pgrep -lf -- "$PATTERN-$1\$" 2>/dev/null | grep -vq caffeinate; }

case "$ACTION" in
  stop)
    pids=$(robots)
    if [ -z "$pids" ]; then echo "Aucun robot en marche."; exit 0; fi
    kill -TERM ${=pids} && echo "Arrêt demandé : chaque robot finit sa fiche en cours."
    exit 0 ;;
  status)
    echo "Robots en marche : $(robots | grep -c . || true)"
    for f in logs/mac-discovery-*.log(N); do echo "── $f"; tail -n 5 "$f"; done
    exit 0 ;;
  start) ;;
  *) echo "Usage : $0 [start N | status | stop]"; exit 1 ;;
esac

if [ ! -f .env.cloud ]; then
  echo "Fichier workers/.env.cloud introuvable (adresse de la vraie base)."
  exit 1
fi

# Adresse de la vraie base, par le pooler en mode transaction (port 6543) comme les robots des serveurs
DB_URL=$(grep '^DATABASE_URL=' .env.cloud | cut -d= -f2- | sed 's/:5432\//:6543\//')
mkdir -p logs

started=0
for i in $(seq 1 "$COUNT"); do
  robot_up "$i" && continue   # déjà en marche : on ne lance que les robots manquants
  # départs espacés de quelques secondes, comme l'ancien outil
  [ "$started" -gt 0 ] && sleep 6
  started=$((started + 1))
  env -u PROXY_URL \
    DATABASE_URL="$DB_URL" \
    LOCAL_DISCOVERY=1 \
    WORKER_KINDS=discovery \
    WORKER_ID="mac-$(hostname -s)-$i" \
    WORKER_IDLE_SECONDS=10 \
    PROXY_DAILY_BUDGET_GB=0 \
    HEADLESS=true \
    nohup caffeinate -i .venv/bin/python -m leadmaker_workers.main "mac-discovery-$i" \
    >> "logs/mac-discovery-$i.log" 2>&1 &
done

if [ "$started" -eq 0 ]; then
  echo "Les $COUNT robots tournent déjà."
  exit 0
fi
sleep 3
echo "$started robot(s) lancé(s) sur ce Mac (sans proxy), $COUNT au total. Suivi : $0 status — arrêt : $0 stop"
