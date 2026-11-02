# Stripe en mode réel — marche à suivre (forfaits en dollars du 2/11/2026)

Aujourd'hui l'app tourne avec Stripe en **mode test** (sandbox du compte reviewcleaner) : clé `rk_test`, prix de test en euros, webhook relayé par Docker en local. Pour encaisser de vrais paiements, tout se fait dans le tableau de bord Stripe par Gabriel, puis 9 variables sont posées chez Vercel. Rien dans le code ne change.

Comment l'app relie Stripe aux forfaits : chaque bouton « S'abonner » envoie à Stripe un **identifiant de prix** (`price_…`) lu dans une variable `NEXT_PUBLIC_STRIPE_PRICE_<FORFAIT>_<PÉRIODE>`. Quand Stripe confirme le paiement, il appelle `https://prospectigo.com/api/billing/webhook`, l'app retrouve le forfait à partir du prix et crédite l'organisation (`lm_reset_credits`). Donc : 6 prix, 1 clé secrète, 1 clé publique, 1 secret de webhook.

## 1. Activer le compte Stripe (une fois)
1. https://dashboard.stripe.com → bascule **Mode test → Mode réel** (en haut à droite).
2. Si Stripe demande d'« activer le compte » : coordonnées de l'entreprise, représentant, **compte bancaire de versement**, descripteur de relevé (« PROSPECTIGO »). Sans ça, pas de paiement réel.
3. Devise : les prix sont en **USD**. Un compte Stripe France reçoit les versements en euros avec une conversion Stripe (~1 % en plus des frais). C'est normal et accepté ; si un jour un compte bancaire en dollars existe, on l'ajoute dans Paramètres → Comptes bancaires.
4. Paramètres → Facturation → **Portail client** : activer « Annuler l'abonnement », « Changer de forfait » (ajouter les 3 produits une fois créés) et « Mettre à jour le moyen de paiement ». L'app envoie les clients sur ce portail depuis Facturation.

## 2. Créer les 3 produits et 6 prix en dollars
Option A (recommandée, sans faute de frappe) :
1. Mode réel → Développeurs → Clés API → **Créer une clé restreinte** nommée « prospectigo-prix », permission **Produits : écriture** seulement. Copier la clé (`rk_live_…`).
2. Dans le terminal, depuis `~/LeadMaker/app` : `./workers/scripts/stripe-create-prices.sh` (la clé est lue dans le presse-papiers, jamais affichée). Le script crée Growth 499 $/mois + 4 990 $/an, Business 990 $ + 9 900 $, Scale 1 999 $ + 19 990 $ et affiche les 6 lignes `NEXT_PUBLIC_STRIPE_PRICE_…=price_…` (aussi dans `workers/.stripe-prices.env`, non versionné).
3. Supprimer ensuite cette clé restreinte dans Stripe (elle ne sert plus).

Option B (à la main) : Catalogue de produits → + Ajouter un produit, 3 fois, avec pour chacun deux prix **récurrents** en **USD** : mensuel et annuel. Relever les 6 `price_…` (bouton « … » → Copier l'identifiant du prix).

## 3. Clés pour l'app (mode réel)
1. Développeurs → Clés API : copier la **clé publiable** `pk_live_…`.
2. Créer une **clé restreinte** « prospectigo-app » `rk_live_…` avec les mêmes droits que la clé de test actuelle : Customers (écriture), Checkout Sessions (écriture), Subscriptions (écriture), Products et Prices (lecture), Invoices (lecture), Billing Portal (écriture), Webhook Endpoints (lecture). Copier la clé une seule fois.

## 4. Webhook
1. Développeurs → Webhooks → + Ajouter une destination (mode réel) → URL `https://prospectigo.com/api/billing/webhook`.
2. Événements à cocher : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`.
3. Copier le **secret de signature** `whsec_…`.

## 5. Poser les variables chez Vercel (Production uniquement)
Depuis `~/LeadMaker/app` (dossier relié au projet Vercel ; jamais depuis apps/web) :
```
npx vercel env rm STRIPE_SECRET_KEY production -y
npx vercel env rm STRIPE_WEBHOOK_SECRET production -y
npx vercel env rm NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY production -y
pbpaste | npx vercel env add STRIPE_SECRET_KEY production --sensitive        # presse-papiers = rk_live_…
pbpaste | npx vercel env add STRIPE_WEBHOOK_SECRET production --sensitive    # presse-papiers = whsec_…
pbpaste | npx vercel env add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY production   # presse-papiers = pk_live_…
while IFS='=' read -r k v; do printf '%s' "$v" | npx vercel env add "$k" production; done < workers/.stripe-prices.env
```
(`rm` échoue sans gravité si la variable n'existe pas encore ; la pré-production garde ses clés de test.)
Puis redéployer la prod : `npx vercel redeploy https://prospectigo.com` ou pousser un commit sur main.

## 6. Test réel, puis remboursement
1. Avec une équipe de test, Facturation → Growth mensuel → payer avec une vraie carte.
2. Vérifier : abonnement visible dans Stripe, ligne `subscriptions` en base, `lm_account_credits` = growth 30 000 / 15 000, webhook en « 200 » dans Stripe → Webhooks.
3. Rembourser le paiement dans Stripe (Paiements → Rembourser) et annuler l'abonnement.

## Et la pré-production ?
staging.prospectigo.com garde Stripe en mode test. Pour pouvoir tester un paiement là-bas : relancer `stripe-create-prices.sh` avec une clé **de test** (`rk_test_…`, les prix de test actuels sont en euros et aux anciens montants), poser les 6 prix obtenus sur l'environnement **Preview**, et ajouter un webhook test vers `https://staging.prospectigo.com/api/billing/webhook` (secret dans `STRIPE_WEBHOOK_SECRET` Preview).

## À retenir
- Ne jamais lancer `stripe login` ni coller une clé dans le chat : presse-papiers → `pbpaste`.
- Les identifiants de prix changent entre test et réel : les 6 variables de Production doivent être celles créées en mode réel.
- Les clients déjà crédités à la main (Namma Booster, Review Cleaner, jerem) continuent sans Stripe ; `lm_reset_credits` suffit pour les recharger.
