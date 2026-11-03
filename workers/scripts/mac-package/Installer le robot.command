#!/bin/zsh
# Installe le robot Prospectigo « recherche sans proxy » sur ce Mac, une seule fois.
# Ensuite : quand une campagne est passée sur « Recherche sur l'ordinateur dédié » sur la plateforme, le robot
# démarre tout seul sur ce Mac (et s'arrête tout seul quand il n'y a plus rien à chercher).
# Relancer ce fichier = mise à jour (le robot est réinstallé à l'identique).
set -eu

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${PROSPECTIGO_ROBOT_DIR:-$HOME/Prospectigo-robot}"   # hors Bureau / Téléchargements (protégés par macOS)
LABEL=com.prospectigo.mac-discovery-launcher

echo ""
echo "=== Installation du robot Prospectigo ==="
echo ""

[ -f "$SRC/.env.cloud" ] || { echo "Fichier de connexion manquant dans le paquet. Demande un nouveau paquet à Gabriel."; exit 1; }

# Réinstallation : on arrête d'abord le veilleur et le robot éventuels
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
[ -x "$DEST/scripts/run-mac-discovery.sh" ] && "$DEST/scripts/run-mac-discovery.sh" stop >/dev/null 2>&1 || true

echo "1/4  Copie du robot dans $DEST"
mkdir -p "$DEST"
rsync -a --delete --exclude '.venv' --exclude 'logs' --exclude 'Installer le robot.command' --exclude 'LISEZ-MOI.txt' "$SRC/" "$DEST/"
chmod 600 "$DEST/.env.cloud"
chmod +x "$DEST"/scripts/*.sh
cd "$DEST"

echo "2/4  Installation de Python (outil uv, sans toucher au reste du Mac)"
UV=$(command -v uv 2>/dev/null || true)
if [ -z "$UV" ]; then
  UV="$HOME/.local/bin/uv"
  if [ ! -x "$UV" ]; then
    curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh >/dev/null
  fi
fi
"$UV" venv --quiet --allow-existing --python 3.13 .venv
"$UV" pip install --quiet --python .venv/bin/python -r requirements.txt

echo "3/4  Installation du navigateur du robot (peut prendre 1 à 2 minutes)"
.venv/bin/python -m playwright install chromium >/dev/null

echo "4/4  Démarrage automatique"
if [ "${PROSPECTIGO_SKIP_LAUNCHER:-0}" = "1" ]; then
  echo "     (sauté pour un essai)"
else
  ./scripts/install-mac-launcher.sh
fi

echo ""
echo "C'est installé. Rien d'autre à faire : sur la plateforme, active « Recherche sur l'ordinateur dédié »"
echo "sur une campagne en cours, et le robot démarre tout seul sur ce Mac. Laisse le Mac allumé et connecté."
echo ""
