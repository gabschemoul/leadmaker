#!/bin/bash
# Lance les deux interfaces (scan sur le port 8600, bot de contact sur le port 8601) et leurs liens Internet.
cd "$(dirname "$0")" || exit 1
mkdir -p data
pkill -f "streamlit run .*$(pwd)" 2>/dev/null; pkill -f "$(pwd)/bin/cloudflared" 2>/dev/null; sleep 1
nohup .venv/bin/streamlit run "$(pwd)/app.py" --server.port 8600 --server.headless true >> data/ui_scan.log 2>&1 &
nohup .venv/bin/streamlit run "$(pwd)/contact/app.py" --server.port 8601 --server.headless true >> data/ui_contact.log 2>&1 &
: > data/tunnel_scan.log; : > data/tunnel_contact.log
nohup "$(pwd)/bin/cloudflared" tunnel --no-autoupdate --url http://localhost:8600 >> data/tunnel_scan.log 2>&1 &
nohup "$(pwd)/bin/cloudflared" tunnel --no-autoupdate --url http://localhost:8601 >> data/tunnel_contact.log 2>&1 &
echo "Démarrage… (20 secondes)"
for i in $(seq 1 30); do
  S=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' data/tunnel_scan.log | head -1)
  C=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' data/tunnel_contact.log | head -1)
  [ -n "$S" ] && [ -n "$C" ] && break; sleep 1
done
cat > LIENS.txt <<TXT
Liens Internet (protégés par mot de passe, valables jusqu'au prochain lancement) :
  Scan automatique : ${S:-pas encore disponible, relance}
  Bot de contact   : ${C:-pas encore disponible, relance}
Sur ce Mac : http://localhost:8600 (scan) et http://localhost:8601 (bot de contact)
TXT
cat LIENS.txt
open "http://localhost:8600"
open "http://localhost:8601"
echo
echo "Tu peux fermer cette fenêtre : tout continue de tourner. Pour tout arrêter : « 3 - Arrêter.command »."
