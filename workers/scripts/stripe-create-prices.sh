#!/bin/bash
# Crée dans Stripe les 3 produits Prospectigo et leurs 6 prix en DOLLARS (forfaits du 2/11/2026),
# puis affiche les 6 identifiants de prix à coller dans les variables d'environnement.
#
# Utilisation (Gabriel) :
#   1. Dans Stripe (mode RÉEL ou mode test, au choix) : Développeurs → Clés API → créer une clé
#      RESTREINTE avec « Produits : écriture » (Products write), copier la clé dans le presse-papiers.
#   2. ./workers/scripts/stripe-create-prices.sh          → lit la clé dans le presse-papiers
#      ./workers/scripts/stripe-create-prices.sh --dry    → montre seulement ce qui serait créé
#   La clé n'est jamais affichée ni écrite sur le disque. Relancer le script crée des DOUBLONS :
#   ne le lancer qu'une fois par mode (test / réel).
set -euo pipefail

DRY=${1:-}
if [ "$DRY" = "--dry" ]; then
  KEY=""
else
  KEY=$(pbpaste | tr -d '[:space:]')
  case "$KEY" in
    rk_live_*|sk_live_*) MODE="RÉEL (live)";;
    rk_test_*|sk_test_*) MODE="TEST";;
    *) echo "Le presse-papiers ne contient pas une clé Stripe (rk_live_…, rk_test_…, sk_…)."; exit 1;;
  esac
  echo "Mode Stripe détecté : $MODE"
fi

# id | nom | description | mensuel (cents) | annuel (cents) | variable mensuelle | variable annuelle
PLANS=(
  "growth|Prospectigo Growth|30 000 crédits de prospection et 15 000 prises de contact par mois|49900|499000|NEXT_PUBLIC_STRIPE_PRICE_GROWTH_MONTHLY|NEXT_PUBLIC_STRIPE_PRICE_GROWTH_YEARLY"
  "business|Prospectigo Business|80 000 crédits de prospection et 40 000 prises de contact par mois|99000|990000|NEXT_PUBLIC_STRIPE_PRICE_BUSINESS_MONTHLY|NEXT_PUBLIC_STRIPE_PRICE_BUSINESS_YEARLY"
  "scale|Prospectigo Scale|200 000 crédits de prospection et 100 000 prises de contact par mois|199900|1999000|NEXT_PUBLIC_STRIPE_PRICE_SCALE_MONTHLY|NEXT_PUBLIC_STRIPE_PRICE_SCALE_YEARLY"
)

api() { # api <chemin> <champ=valeur...> (chaque valeur est encodée : espaces, accents)
  local path=$1; shift
  local args=() field
  for field in "$@"; do args+=(--data-urlencode "$field"); done
  curl -sS -u "$KEY:" "https://api.stripe.com/v1/$path" "${args[@]}"
}

json_field() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get(sys.argv[1]) or d.get("error",{}).get("message") or "")' "$1"; }

OUT=""
for row in "${PLANS[@]}"; do
  IFS='|' read -r id name desc monthly yearly var_m var_y <<< "$row"
  echo ""
  echo "→ $name : $((monthly/100)) \$ / mois, $((yearly/100)) \$ / an"
  if [ "$DRY" = "--dry" ]; then continue; fi

  product=$(api products "name=$name" "description=$desc" "metadata[prospectigo_plan]=$id" | json_field id)
  [[ "$product" == prod_* ]] || { echo "  ✗ création du produit refusée : $product"; exit 1; }

  price_m=$(api prices "product=$product" "currency=usd" "unit_amount=$monthly" "recurring[interval]=month" "nickname=$name mensuel" | json_field id)
  price_y=$(api prices "product=$product" "currency=usd" "unit_amount=$yearly" "recurring[interval]=year" "nickname=$name annuel" | json_field id)
  [[ "$price_m" == price_* && "$price_y" == price_* ]] || { echo "  ✗ création des prix refusée : $price_m / $price_y"; exit 1; }
  echo "  produit $product, prix $price_m (mensuel) et $price_y (annuel)"
  OUT+="$var_m=$price_m"$'\n'"$var_y=$price_y"$'\n'
done

if [ -n "$OUT" ]; then
  echo ""
  echo "Variables à poser (Vercel → Production si clé réelle, Preview si clé test) :"
  echo "$OUT"
  printf '%s' "$OUT" > workers/.stripe-prices.env
  echo "(aussi écrites dans workers/.stripe-prices.env, fichier ignoré par git)"
fi
