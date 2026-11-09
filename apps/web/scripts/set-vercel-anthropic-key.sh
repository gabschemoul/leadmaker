#!/bin/bash
# Pose la clé de l'IA (ANTHROPIC_API_KEY) sur Vercel, pour l'appli web (nouveau parcours campagne : propositions
# de l'écran « Qui ? », « Proposer avec l'IA »). La clé est lue dans workers/.env.ai (même clé que les robots),
# jamais affichée. À lancer par Gabriel depuis ~/LeadMaker/app :
#   ! ./apps/web/scripts/set-vercel-anthropic-key.sh
# Puis redéployer (un push sur staging suffit, ou « Redeploy » dans Vercel) pour que la clé soit prise en compte.
set -euo pipefail
cd "$(dirname "$0")/../../.."   # racine du dépôt (dossier lié au projet Vercel, .vercel/)
KEY=$(grep '^ANTHROPIC_API_KEY=' workers/.env.ai | cut -d= -f2- | tr -d '"' | tr -d "'")
[ -n "$KEY" ] || { echo "Clé introuvable dans workers/.env.ai"; exit 1; }
for target in production preview; do
  npx vercel env rm ANTHROPIC_API_KEY "$target" --yes >/dev/null 2>&1 || true
  printf '%s' "$KEY" | npx vercel env add ANTHROPIC_API_KEY "$target" >/dev/null
  echo "✓ ANTHROPIC_API_KEY posée sur Vercel ($target)"
done
