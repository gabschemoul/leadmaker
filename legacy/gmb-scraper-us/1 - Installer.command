#!/bin/bash
# Installation (une seule fois) : Python, modules, navigateur Chrome du bot, cloudflared (lien Internet).
cd "$(dirname "$0")" || exit 1
set -e
echo "=== Installation du scraper US (5 à 10 minutes) ==="
if ! command -v uv >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/uv" ]; then
  echo "→ Installation de uv (gestionnaire Python)…"
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
UV="$(command -v uv 2>/dev/null || echo "$HOME/.local/bin/uv")"
echo "→ Python 3.11 et modules…"
"$UV" venv --python 3.11 .venv
"$UV" pip install --python .venv/bin/python -r requirements.txt
echo "→ Navigateur Chrome du bot…"
.venv/bin/python -m playwright install chromium
echo "→ cloudflared (lien Internet)…"
ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH=amd64
mkdir -p bin
curl -sL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-$ARCH.tgz" | tar xz -C bin
chmod +x bin/cloudflared
xattr -dr com.apple.quarantine . 2>/dev/null || true
echo
echo "=== Installation terminée. Double-clique sur « 2 - Lancer.command ». ==="
read -r -p "Appuie sur Entrée pour fermer…"
