#!/bin/bash
# Donne l'adresse ACTUELLE du serveur d'envoi, lue chez Hetzner (elle change chaque nuit, voir
# rotate_send_ip.py), et met à jour workers/.send-server-ip au passage.
# Si Hetzner ne répond pas, on garde l'adresse notée dans le fichier.
#   IP=$(workers/scripts/send-server-ip.sh)
set -uo pipefail
cd "$(dirname "$0")/../.."
FILE=workers/.send-server-ip
OLD=$(cat "$FILE" 2>/dev/null || true)
NEW=""
if [ -s workers/.hetzner-token ]; then
  NEW=$(curl -sS --max-time 15 -H "Authorization: Bearer $(cat workers/.hetzner-token)" \
        "https://api.hetzner.cloud/v1/servers?name=leadmaker-envoi-1" 2>/dev/null \
      | python3 -c "import sys,json;s=json.load(sys.stdin)['servers'];print(s[0]['public_net']['ipv4']['ip'] if len(s)==1 and s[0]['public_net'].get('ipv4') else '')" 2>/dev/null || true)
fi
if [ -n "$NEW" ] && [ "$NEW" != "$OLD" ]; then
  echo "$NEW" > "$FILE"
  [ -n "$OLD" ] && ssh-keygen -R "$OLD" >/dev/null 2>&1
  echo "(adresse du serveur d'envoi mise à jour : $OLD → $NEW)" >&2
fi
IP=${NEW:-$OLD}
[ -n "$IP" ] || { echo "Pas de serveur d'envoi trouvé" >&2; exit 1; }
echo "$IP"
