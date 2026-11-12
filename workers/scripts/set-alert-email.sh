#!/bin/bash
# Branche les alertes des robots : dépose la clé Resend (lue dans ~/LeadMaker/app/.env.resend, jamais affichée)
# et l'adresse qui reçoit les alertes dans le .env des DEUX serveurs, puis (re)lance le surveillant.
#   ./workers/scripts/set-alert-email.sh                      # alertes vers schemoul.gabriel@gmail.com
#   ./workers/scripts/set-alert-email.sh autre@adresse.com    # autre adresse
# Ensuite, un e-mail d'essai part de chaque serveur : s'il arrive, les alertes arriveront.
set -euo pipefail
cd "$(dirname "$0")/../.."
KEY=~/.ssh/leadmaker_hetzner
MAIN=2.31.72.125
EMAIL=${1:-schemoul.gabriel@gmail.com}
RESEND=$(tr -d '[:space:]' < .env.resend 2>/dev/null || true)
[ -n "$RESEND" ] || { echo "Clé Resend introuvable dans .env.resend"; exit 1; }
SEND_IP=$(workers/scripts/send-server-ip.sh 2>/dev/null || true)

configure() {
  local ip=$1 service=$2 profile=$3
  echo "→ $ip : clé Resend + adresse d'alerte dans .env, lancement du surveillant"
  # La clé passe par l'entrée standard de ssh : elle n'apparaît ni dans la ligne de commande ni dans l'historique.
  printf 'RESEND_API_KEY=%s\nALERT_EMAIL=%s\n' "$RESEND" "$EMAIL" | ssh -i "$KEY" -o StrictHostKeyChecking=accept-new root@"$ip" \
    "cd /opt/leadmaker/workers && grep -vE '^(RESEND_API_KEY|ALERT_EMAIL)=' .env > .env.new && cat >> .env.new && mv .env.new .env && chmod 600 .env \
     && docker compose $profile up -d --build $service \
     && sleep 5 && docker compose $profile run --rm --no-deps -T $service python -m leadmaker_workers.watchdog --test"
}

configure "$MAIN" watch ""
if [ -n "$SEND_IP" ]; then
  configure "$SEND_IP" watch-send "--profile send"
else
  echo "(pas de serveur d'envoi : workers/.send-server-ip absent, seul le serveur principal surveille)"
fi
echo "✓ Alertes branchées vers $EMAIL. Deux e-mails d'essai doivent arriver dans la minute."
