#!/bin/zsh
# Installe le veilleur de l'ordinateur dédié sur ce Mac : il démarre à l'ouverture de session (launchd) et lance /
# arrête tout seul le robot de recherche sans proxy selon l'interrupteur de la plateforme (leadmaker_workers/local_launcher.py).
#
#   ./workers/scripts/install-mac-launcher.sh            → installe et démarre le veilleur
#   ./workers/scripts/install-mac-launcher.sh uninstall  → retire le veilleur (et arrête le robot)
set -eu
cd "$(dirname "$0")/.."
WORKERS=$(pwd)
LABEL=com.prospectigo.mac-discovery-launcher
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "${1:-install}" = "uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  ./scripts/run-mac-discovery.sh stop
  echo "Veilleur retiré : le robot ne se lancera plus tout seul."
  exit 0
fi

[ -x .venv/bin/python ] || { echo "Environnement Python introuvable (workers/.venv)."; exit 1; }
[ -f .env.cloud ] || { echo "Fichier workers/.env.cloud introuvable (adresse de la vraie base)."; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents" logs

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$WORKERS/.venv/bin/python</string>
    <string>-m</string>
    <string>leadmaker_workers.local_launcher</string>
  </array>
  <key>WorkingDirectory</key><string>$WORKERS</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <!-- le robot lancé par le veilleur continue s'il redémarre -->
  <key>AbandonProcessGroup</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$WORKERS/logs/mac-launcher.log</string>
  <key>StandardErrorPath</key><string>$WORKERS/logs/mac-launcher.log</string>
</dict>
</plist>
PLIST

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
sleep 3
echo "Veilleur installé : il démarre avec ta session et lance le robot dès qu'une campagne est sur l'ordinateur dédié."
tail -n 3 logs/mac-launcher.log
