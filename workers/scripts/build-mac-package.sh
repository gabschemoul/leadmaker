#!/bin/zsh
# Fabrique le paquet d'installation du robot « recherche sans proxy » pour un autre Mac (ex. celui de Nath).
#   ./workers/scripts/build-mac-package.sh   → ~/Desktop/Robot-Prospectigo.zip
# ATTENTION : le paquet contient l'accès complet à la base (workers/.env.cloud). À envoyer en privé seulement.
set -eu
cd "$(dirname "$0")/.."
OUT="${1:-$HOME/Desktop/Robot-Prospectigo.zip}"
TMP=$(mktemp -d)
PKG="$TMP/Robot-Prospectigo"
mkdir -p "$PKG/scripts" "$PKG/data"
rsync -a --exclude '__pycache__' leadmaker_workers "$PKG/"
cp data/categories.json data/generic.txt "$PKG/data/"
cp scripts/run-mac-discovery.sh scripts/install-mac-launcher.sh "$PKG/scripts/"
cp requirements.txt .env.cloud "$PKG/"
cp "scripts/mac-package/Installer le robot.command" "$PKG/"
chmod +x "$PKG/Installer le robot.command" "$PKG"/scripts/*.sh
cat > "$PKG/LISEZ-MOI.txt" <<'TXT'
Robot Prospectigo — recherche sans proxy

Installation (une seule fois, environ 3 minutes) :
1. Ouvre l'application Terminal (Cmd + Espace, tape « Terminal », Entrée).
2. Tape  zsh  suivi d'un espace, puis glisse le fichier « Installer le robot.command » dans la fenêtre du Terminal.
3. Appuie sur Entrée et attends le message « C'est installé ».

Ensuite, plus rien à faire : sur la plateforme, active « Recherche sur l'ordinateur dédié » sur une campagne
en cours, et le robot démarre tout seul sur ce Mac en moins d'une minute. Laisse le Mac allumé et connecté.

Ce dossier contient un accès privé : ne le partage pas. Tu peux le supprimer après l'installation.
TXT
rm -f "$OUT"
ditto -c -k --keepParent "$PKG" "$OUT"
rm -rf "$TMP"
echo "Paquet prêt : $OUT"
