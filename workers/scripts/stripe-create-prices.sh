#!/bin/bash
# Crée dans Stripe les 3 abonnements Prospectigo (Growth, Business, Scale) et leurs 12 prix : mensuel et annuel,
# en DOLLARS et en EUROS (mêmes chiffres), puis affiche les identifiants à poser dans Vercel.
# Crédit unique (9/11/2026) : Growth 15 000, Business 40 000, Scale 100 000 crédits par mois.
#
# Clé Stripe (restreinte, « Products : écriture » et « Prices : écriture ») lue, sans jamais l'afficher :
#   1. dans workers/.stripe-admin.key (fichier ignoré par git, chmod 600) s'il existe ;
#   2. sinon dans le presse-papiers.
#   ./workers/scripts/stripe-create-prices.sh          → crée (ou réutilise) produits et prix
#   ./workers/scripts/stripe-create-prices.sh --dry    → montre seulement ce qui serait créé
# Relançable : un produit (repéré par metadata prospectigo_plan) ou un prix déjà là (même devise, même
# période, même montant) est réutilisé, jamais créé en double.
set -euo pipefail

DRY=${1:-}
KEY_FILE="$(cd "$(dirname "$0")/.." && pwd)/.stripe-admin.key"

if [ "$DRY" = "--dry" ]; then
  KEY=""
else
  if [ -f "$KEY_FILE" ]; then KEY=$(tr -d '[:space:]' < "$KEY_FILE"); else KEY=$(pbpaste | tr -d '[:space:]'); fi
  case "$KEY" in
    rk_live_*|sk_live_*) echo "Mode Stripe détecté : RÉEL";;
    rk_test_*|sk_test_*) echo "Mode Stripe détecté : TEST";;
    *) echo "Pas de clé Stripe (workers/.stripe-admin.key ou presse-papiers : rk_live_…, rk_test_…)."; exit 1;;
  esac
fi

# id | nom | description | mensuel (centimes) | annuel (centimes) | préfixe des variables
PLANS=(
  "growth|Prospectigo Growth|15 000 crédits par mois : 1 crédit = 1 entreprise gardée, prise de contact incluse|49900|499000|NEXT_PUBLIC_STRIPE_PRICE_GROWTH"
  "business|Prospectigo Business|40 000 crédits par mois : 1 crédit = 1 entreprise gardée, prise de contact incluse|99000|990000|NEXT_PUBLIC_STRIPE_PRICE_BUSINESS"
  "scale|Prospectigo Scale|100 000 crédits par mois : 1 crédit = 1 entreprise gardée, prise de contact incluse|199900|1999000|NEXT_PUBLIC_STRIPE_PRICE_SCALE"
)

api() { # api <POST|GET> <chemin> <champ=valeur...> (valeurs encodées : espaces, accents)
  local method=$1 path=$2; shift 2
  local args=() field
  for field in "$@"; do args+=(--data-urlencode "$field"); done
  if [ "$method" = "GET" ]; then
    curl -sS -G -u "$KEY:" "https://api.stripe.com/v1/$path" "${args[@]}"
  else
    curl -sS -u "$KEY:" "https://api.stripe.com/v1/$path" "${args[@]}"
  fi
}

json_field() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get(sys.argv[1]) or d.get("error",{}).get("message") or "")' "$1"; }

# Produit déjà créé pour ce forfait (metadata prospectigo_plan), sinon vide
find_product() {
  api GET products/search "query=metadata['prospectigo_plan']:'$1' AND active:'true'" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("data") or [{}])[0].get("id",""))'
}

# Prix actif déjà là pour ce produit (devise, période, montant), sinon vide
find_price() { # find_price <produit> <devise> <period> <montant>
  api GET prices "product=$1" "active=true" "limit=100" | python3 -c '
import json, sys
cur, period, amount = sys.argv[1], sys.argv[2], int(sys.argv[3])
for p in json.load(sys.stdin).get("data", []):
    if p.get("currency") == cur and (p.get("recurring") or {}).get("interval") == period and p.get("unit_amount") == amount:
        print(p["id"]); break
' "$2" "$3" "$4"
}

price_for() { # price_for <produit> <devise> <period> <montant> <surnom>
  local found
  found=$(find_price "$1" "$2" "$3" "$4")
  if [ -n "$found" ]; then echo "$found"; return; fi
  api POST prices "product=$1" "currency=$2" "unit_amount=$4" "recurring[interval]=$3" "nickname=$5" | json_field id
}

OUT=""
for row in "${PLANS[@]}"; do
  IFS='|' read -r id name desc monthly yearly var <<< "$row"
  echo ""
  echo "→ $name : $((monthly/100)) \$ et € par mois, $((yearly/100)) \$ et € par an"
  if [ "$DRY" = "--dry" ]; then continue; fi

  product=$(find_product "$id")
  if [ -z "$product" ]; then
    product=$(api POST products "name=$name" "description=$desc" "metadata[prospectigo_plan]=$id" | json_field id)
  fi
  [[ "$product" == prod_* ]] || { echo "  ✗ produit refusé : $product"; exit 1; }

  for cur in usd eur; do
    up=$(echo "$cur" | tr '[:lower:]' '[:upper:]')  # bash 3 du Mac : pas de $up
    suffix=$([ "$cur" = "eur" ] && echo "_EUR" || echo "")
    pm=$(price_for "$product" "$cur" month "$monthly" "$name mensuel $up")
    py=$(price_for "$product" "$cur" year "$yearly" "$name annuel $up")
    [[ "$pm" == price_* && "$py" == price_* ]] || { echo "  ✗ prix refusés ($cur) : $pm / $py"; exit 1; }
    echo "  $up : $pm (mensuel), $py (annuel)"
    OUT+="${var}_MONTHLY${suffix}=$pm"$'\n'"${var}_YEARLY${suffix}=$py"$'\n'
  done
done

if [ -n "$OUT" ]; then
  echo ""
  echo "Variables à poser (Vercel → Production si clé réelle) :"
  echo "$OUT"
  printf '%s' "$OUT" > "$(dirname "$KEY_FILE")/.stripe-prices.env"
  echo "(aussi écrites dans workers/.stripe-prices.env, fichier ignoré par git)"
fi
