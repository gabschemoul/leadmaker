#!/bin/bash
# Installe la rotation QUOTIDIENNE de l'adresse du serveur d'envoi, lancée par le serveur principal
# (toujours allumé) chaque nuit à 03:00 UTC (4 h ou 5 h à Paris selon l'heure d'été).
#   ./workers/scripts/install-ip-rotation.sh            → installe / met à jour
#   ./workers/scripts/install-ip-rotation.sh --remove   → retire la tâche de nuit
# Le serveur principal reçoit : le script, le jeton Hetzner (chmod 600) et une clé SSH à lui pour
# arrêter / relancer les robots du serveur d'envoi. Journal : /var/log/leadmaker-rotate.log sur le principal.
set -euo pipefail
cd "$(dirname "$0")/../.."
KEY=~/.ssh/leadmaker_hetzner
MAIN=2.31.72.125
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new)
DIR=/opt/leadmaker/rotate
CRON_LINE="0 3 * * * /usr/bin/python3 $DIR/rotate_send_ip.py --token-file $DIR/.hetzner-token --ssh-key /root/.ssh/leadmaker_envoi --known-hosts $DIR/known_hosts --env-file /opt/leadmaker/workers/.env --ip-file $DIR/send-server-ip >> /var/log/leadmaker-rotate.log 2>&1"

if [ "${1:-}" = "--remove" ]; then
  "${SSH[@]}" root@$MAIN "crontab -l 2>/dev/null | grep -v rotate_send_ip.py | crontab -"
  echo "Rotation de nuit retirée."
  exit 0
fi

SEND_IP=$(workers/scripts/send-server-ip.sh)
[ "$SEND_IP" != "$MAIN" ] || { echo "Adresse d'envoi = adresse principale : arrêt"; exit 1; }

echo "→ serveur principal : script, jeton et clé SSH dédiée"
"${SSH[@]}" root@$MAIN "mkdir -p $DIR && chmod 700 $DIR && [ -f /root/.ssh/leadmaker_envoi ] || ssh-keygen -q -t ed25519 -N '' -C leadmaker-rotate -f /root/.ssh/leadmaker_envoi"
scp -q -i "$KEY" workers/scripts/rotate_send_ip.py root@$MAIN:$DIR/rotate_send_ip.py
# le jeton passe par l'entrée standard : jamais dans une ligne de commande
"${SSH[@]}" root@$MAIN "umask 077 && cat > $DIR/.hetzner-token" < workers/.hetzner-token
echo "$SEND_IP" | "${SSH[@]}" root@$MAIN "cat > $DIR/send-server-ip"

echo "→ serveur d'envoi : autorise la clé du serveur principal"
PUB=$("${SSH[@]}" root@$MAIN "cat /root/.ssh/leadmaker_envoi.pub")
"${SSH[@]}" root@"$SEND_IP" "grep -qxF '$PUB' /root/.ssh/authorized_keys 2>/dev/null || echo '$PUB' >> /root/.ssh/authorized_keys"

echo "→ essai à blanc depuis le serveur principal"
"${SSH[@]}" root@$MAIN "python3 $DIR/rotate_send_ip.py --dry-run --token-file $DIR/.hetzner-token --ssh-key /root/.ssh/leadmaker_envoi --known-hosts $DIR/known_hosts --env-file /opt/leadmaker/workers/.env --ip-file $DIR/send-server-ip"

echo "→ tâche de nuit (03:00 UTC)"
printf '%s\n' "$CRON_LINE" | "${SSH[@]}" root@$MAIN "{ crontab -l 2>/dev/null | grep -v rotate_send_ip.py; cat; } | crontab - && crontab -l | grep rotate_send_ip.py"
echo "Installé."
