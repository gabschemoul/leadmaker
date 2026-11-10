#!/bin/bash
# Liste les prix ACTIFS du compte Stripe (produit, montant, devise, mensuel / annuel / unique, identifiant
# price_…), pour brancher les abonnements et les packs de Prospectigo sans recopier les identifiants à la main.
#
# Utilisation (Gabriel) :
#   1. Stripe (mode RÉEL) → Développeurs → Clés API → créer une clé RESTREINTE en LECTURE seule :
#      « Produits : lecture » et « Prix : lecture » (Products read, Prices read). Copier la clé.
#   2. ./workers/scripts/stripe-list-prices.sh   → lit la clé dans le presse-papiers (jamais affichée).
#   3. Supprimer ensuite la clé dans Stripe.
# Ne crée ni ne modifie rien dans Stripe.
set -euo pipefail

KEY=$(pbpaste | tr -d '[:space:]')
case "$KEY" in
  rk_live_*|sk_live_*) echo "Mode Stripe : RÉEL";;
  rk_test_*|sk_test_*) echo "Mode Stripe : TEST";;
  *) echo "Le presse-papiers ne contient pas une clé Stripe (rk_live_…, rk_test_…)."; exit 1;;
esac

curl -sS -G -u "$KEY:" "https://api.stripe.com/v1/prices" \
  --data-urlencode "active=true" --data-urlencode "limit=100" --data-urlencode "expand[]=data.product" \
| python3 -c '
import json, sys
d = json.load(sys.stdin)
if "error" in d:
    sys.exit("Erreur Stripe : " + d["error"].get("message", "?"))
rows = []
for p in d.get("data", []):
    prod = p.get("product") or {}
    name = prod.get("name", "?") if isinstance(prod, dict) else str(prod)
    rec = p.get("recurring") or {}
    period = {"month": "mensuel", "year": "annuel"}.get(rec.get("interval"), "unique") if rec else "unique"
    amount = (p.get("unit_amount") or 0) / 100
    rows.append((name, period, p.get("currency", "").upper(), amount, p["id"]))
for r in sorted(rows):
    print(f"{r[0]:<40} {r[1]:<8} {r[3]:>10.2f} {r[2]:<4} {r[4]}")
print(f"\n{len(rows)} prix actifs.")
'
