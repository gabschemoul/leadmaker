# Prospectigo — architecture et règles de travail

**À lire en premier par toute IA qui travaille sur ce dépôt.** Le reste de `docs/` (hors `docs/prospectigo/`)
est la documentation générique du kit MakerKit sur lequel l'appli est construite.

Dernière mise à jour : 5 novembre 2026 (audit complet : `docs/prospectigo/AUDIT-2026-11-05.md`).

---

## 1. Ce que fait Prospectigo

SaaS B2B vendu dans le monde entier (facturation en dollars). Un client (agence, indépendant, PME) :

1. **Cible** : choisit une zone (pays, villes, rayon) et des activités (plombiers, dentistes…) + des filtres
   (note moyenne, nombre d'avis, avec / sans site web).
2. **Trouve** : une *campagne* lance des recherches ; chaque entreprise retenue devient un *prospect* et coûte
   des **crédits de prospection** (1 à 4 selon la difficulté, voir §7).
3. **Rédige** : écrit 1 à 4 messages (variables `{company}`, `{city}`…).
4. **Contacte** : des robots ouvrent le site de chaque prospect, remplissent son formulaire de contact et
   l'envoient. Chaque envoi coûte un **crédit de prise de contact**. Par défaut le **pilote automatique** enchaîne
   préparation et envoi ; le mode **avancé** laisse valider formulaire par formulaire.

Vocabulaire client : « crédits de prospection », « crédits de prise de contact », « prospects », « prises de
contact ». Fondateurs : Gabriel et Nath (non développeurs). Toute l'interface est en français et en anglais.

## 2. Règles d'or (à respecter sans exception)

1. **Publication.** On travaille sur la branche `staging` (déployée sur https://staging.prospectigo.com).
   `main` (https://prospectigo.com) n'est mis à jour **que quand Gabriel écrit « publie »** :
   `git checkout main && git merge --ff-only staging && git push && git checkout staging`.
2. **Une seule base de données.** La pré-prod et la prod utilisent **le même projet Supabase** (données réelles).
   Une migration poussée s'applique à la prod immédiatement : elle doit rester **compatible avec le code de `main`**
   (ajouter avant de retirer, jamais renommer/supprimer dans la même livraison). C'est Gabriel qui pousse les
   migrations (`! pnpm exec supabase db push` depuis `apps/web`) ; on ne le fait pas à sa place.
3. **Mots interdits** partout sur le site, l'appli, les e-mails et les métadonnées : « scraping », « Google Maps »,
   « note Google ». Dire « recherche », « fiche de l'entreprise », « note moyenne ». Vérifier par `grep` avant de publier.
   Éviter « robot » dans les textes clients.
4. **Robots.** Un seul changement de robot à la fois, toujours via `workers/scripts/deploy-robots.sh` (test avant
   bascule, `--rollback`), 10 minutes de vérification après. **Jamais** relancer, libérer ou redémarrer des
   recherches / robots / tâches en prod sans un « oui » explicite de Gabriel dans le message en cours.
5. **Secrets.** Ne jamais commiter `workers/.env.cloud`, `.env.local`, jetons, clés Stripe/Resend/proxy.
   Commiter par chemins explicites (`git add <fichiers>`), jamais `git add -A` (d'autres conversations peuvent
   travailler dans le même dossier).
6. **Parler à Gabriel** en français, simplement, sans jargon (pas de « migration », « RLS », « worker »…), et lui
   dire de recharger la page (Cmd + R) après un changement visible.

## 3. Vue d'ensemble

```
Navigateur ──► Next.js (Vercel : prospectigo.com = main, staging.prospectigo.com = staging)
                 │  actions serveur (client Supabase de l'utilisateur, RLS)
                 ▼
             Supabase (Postgres + Auth + Realtime + Storage)  ◄── webhook Stripe (crédits)
                 │  file de tâches lm_tasks (SKIP LOCKED)
                 ▼
   Robots Python (Docker) ─────────────────────────────────────────────
   • serveur principal : estimate ×1, discovery ×6, prepare ×6, watch (surveillant)
   • serveur d'envoi   : send ×4 (profil « send »), watch-send
   • Mac dédié de l'équipe : recherche sans proxy pour les campagnes activées (lm_local_discovery_*)
   Proxy résidentiel (recherche uniquement, plafond quotidien : set-proxy-budget.sh) · Resend (e-mails)
```

- Les **actions serveur** utilisent `getSupabaseServerClient()` (droits de l'utilisateur) et appellent des
  fonctions SQL `lm_*`. Le client admin (contourne la RLS) n'est utilisé que dans `power-user.ts` et le webhook.
- Les **robots** se connectent directement à Postgres (`DATABASE_URL`) et n'utilisent que les fonctions SQL
  réservées au rôle service (`lm_claim_task`, `lm_record_prospect`, `lm_finish_prepare`, `lm_finish_send`…).

## 4. Carte du dépôt

| Où | Quoi |
|---|---|
| `apps/web/app/[locale]/home/[account]/campaigns` | Campagnes : création (`new`), page à étapes `[id]` (Cibler / Trouver / Rédiger / Contacter), messages, pilote automatique |
| `apps/web/app/[locale]/home/[account]/prospects` | Liste des prospects, filtres, import CSV, export, actions groupées |
| `apps/web/app/[locale]/home/[account]/forms` | Formulaires préparés (mode avancé) |
| `apps/web/app/[locale]/home/[account]/sender`, `spaces` | Expéditeurs ; dossiers clients (espaces) |
| `apps/web/app/[locale]/home/[account]/_lib/server`, `_components/leadmaker` | Chargeurs et composants partagés Prospectigo |
| `apps/web/lib/leadmaker` | Code partagé client/serveur : CSV, clé de site (`site-key.ts`, identique à `workers/.../text.py`), modèles de messages |
| `apps/web/lib/server/leadmaker` | Serveur seulement : crédits Stripe (`plan-credits.service.ts`), erreurs RPC (`rpc-errors.ts`) |
| `apps/web/config/billing.config.ts` | Forfaits et prix Stripe |
| `apps/web/supabase/schemas/20-34-leadmaker-*.sql` | **Source de vérité** du modèle de données (voir §5) |
| `apps/web/supabase/tests/database/leadmaker-*.test.sql` | Tests pgTAP (isolation, crédits, découverte, envoi, pilote, audit) |
| `workers/leadmaker_workers` | Robots : `main.py` (boucle), `queue.py`, `discovery/` (recherche), `outreach/` (formulaires), `watchdog.py` |
| `workers/scripts` | Déploiement et exploitation (deploy-robots.sh, set-proxy-budget.sh…) |
| `ROADMAP.md` | Feuille de route vivante (décisions datées) |

Tout le reste (`packages/`, auth, comptes, facturation générique) est du MakerKit d'origine : n'y toucher que si
nécessaire, pour garder les mises à jour du kit faciles (remote git `upstream`).

## 5. Modèle de données (schémas 20 à 34)

| Fichier | Contenu |
|---|---|
| 20 enums | statuts (campagne, tâche, tentative…) |
| 21 plans | `lm_plans`, `lm_account_credits`, `lm_credit_ledger`, `lm_debit_credits`, `lm_reset_credits`, `lm_refill_credits`, `lm_member`, `lm_has_plan` |
| 22 spaces | espaces (dossiers clients) et expéditeurs |
| 23 campaigns | `lm_campaigns`, `lm_searches`, normalisation des filtres |
| 24 prospects | prospects, tentatives (`lm_attempts`), réponses, listes d'opposition, `lm_clean_website`, `lm_site_suppressed` |
| 25 tasks | file `lm_tasks` (claim / complete / fail / requeue) |
| 26 geo | villes, pays couverts |
| 27 discovery | ciblage → zones × activités, lancement / pause / modification, planificateur, enregistrement des prospects, import CSV |
| 28 estimates | estimations et mesure du tarif (difficulté) |
| 29 outreach | préparation et validation des formulaires |
| 30 send | mise en file des envois, résultat d'envoi, « à vérifier » |
| 31 emails | recherche d'e-mails |
| 32 campaign copy | duplication de campagne |
| 33 autopilot | pilote automatique (`lm_autopilots`, `lm_autopilot_tick` appelé par `lm_queue_sends`) |
| 34 local discovery | recherche sur le Mac dédié |

Hiérarchie : organisation (compte d'équipe MakerKit) → espace → campagne → zones × activités → recherches →
prospects → tentatives (prises de contact) → pilote automatique.

**Conventions de sécurité SQL** (voir aussi `apps/web/supabase/AGENTS.md`) :
- Toute fonction `SECURITY DEFINER` appelée par l'appli vérifie l'accès avec **`public.lm_member(account_id)`**
  (membre + double authentification), sur **chaque** identifiant reçu (tableaux compris).
- Les refus « métier » lèvent `raise exception ... using hint = '<code>'` ; côté Next.js, `throwRpcError`
  (`lib/server/leadmaker/rpc-errors.ts`) traduit le hint en message.
- Les tables sont en lecture seule pour les clients, sauf colonnes listées par `grant insert/update (colonnes)`.
  Statut, tarif, crédits ne changent que par des fonctions serveur.
- Fonctions réservées aux robots : `revoke all ... from public` + `grant execute ... to service_role`.
- Chaque fonction a un commentaire : rôle, appelant (appli / robot / déclencheur), hypothèses de sécurité.

## 6. File de tâches

`lm_tasks(kind, payload, status, attempts, max_attempts, run_after, priority, idempotency_key)`.
Types : `estimate` (priorité 10), `discovery`, `prepare`, `emails`, `send`. Un robot réclame une tâche avec
`lm_claim_task(kinds, worker_id)` (SKIP LOCKED), puis `lm_complete_task` / `lm_fail_task` (nouvel essai avec
attente exponentielle). `lm_requeue_stale_tasks` reprend les tâches abandonnées. Compteur `in_flight` d'une
activité = nombre de ses tâches `queued` + `running`, rien d'autre. Un envoi n'est **jamais** réessayé
automatiquement (passe « à vérifier »).

Robots de prise de contact : chaque site est traité dans un processus et un navigateur neufs
(`outreach/site_job.py`), avec la **garde réseau** `outreach/netguard.py` (sites web publics uniquement).

## 7. Crédits et argent

- Forfaits (`lm_plans`) : Growth 499 $ (30 000 prospection / 15 000 prise de contact), Business 990 $ (80 000 / 40 000),
  Scale 1 999 $ (200 000 / 100 000) ; annuel = 10 mois. Sièges 1/3/6, campagnes actives 1/3/10, budget proxy 50/100/200 Go.
- **Recharge** : webhook Stripe → `plan-credits.service.ts` → `lm_reset_credits` (idempotent par abonnement +
  période + forfait). Changement de forfait en cours de période = seulement la différence. Forfaits annuels :
  recharge mensuelle par `lm_refill_credits` (pg_cron « lm-refill-credits », toutes les heures).
- **Débits** : `lm_record_prospect` (prospect gardé × `credits_per_prospect`) et `lm_finish_send` (1 par envoi
  réellement soumis). Journal : `lm_credit_ledger` (unique par `event_ref`).
- **Tarif par prospect** : mesuré par une estimation (part des entreprises qui passent les filtres → 1 à 4 crédits).
  Une campagne lancée sans estimation part à 1 crédit (`price_pending`) jusqu'à la fin de la mesure. Changer
  filtres / activités après lancement relance une mesure.
- Estimations : quota de 40 / 24 h par organisation avec forfait, 3 sans.
- Le webhook ignore les événements dont le mode (test / réel) ne correspond pas à la clé Stripe, et tous les
  webhooks sur la pré-prod (sauf `BILLING_WEBHOOK_ENABLED=true`).

## 8. Livrer un changement

| Type | Étapes |
|---|---|
| Écran / texte | modifier → `pnpm typecheck`, `pnpm lint`, `pnpm format:fix` → commit sur `staging` → push → Gabriel teste sur staging |
| Base de données | modifier `schemas/*.sql` → `pnpm --filter web run supabase:db:diff -f nom` → compléter à la main les `grant`/`revoke` (db diff ne les écrit pas) → `supabase migration up` → `pnpm supabase:web:test` (tous verts) → `pnpm supabase:web:typegen` → commit ; **Gabriel** pousse la migration en ligne |
| Robot | modifier `workers/` → test local (`run-local.sh`) → commit → sur feu vert de Gabriel : `deploy-robots.sh` (ou `--send`, `--all`) → vérifier 10 min |

Le serveur local de l'appli tourne sur http://localhost:3001 (le port 3000 est pris sur le Mac de Gabriel).
Toujours `pnpm exec supabase` depuis `apps/web` (la CLI globale est trop vieille).

## 9. Exploitation (scripts)

- `workers/scripts/deploy-robots.sh` : déploie les robots (test, bascule, `--rollback`, `--send`, `--all`).
- `workers/scripts/set-proxy-budget.sh <Go>` : plafond quotidien de proxy.
- `workers/scripts/set-alert-email.sh` : e-mail d'alerte du surveillant.
- `apps/web/scripts/push-auth-emails.sh` : modèles d'e-mails de connexion Supabase.
- `docs/prospectigo/stripe-mode-reel.md` : passage de Stripe en mode réel.

## 10. Glossaire interface ↔ code

| Interface | Code |
|---|---|
| Organisation / équipe | `accounts` (compte d'équipe) |
| Dossier client | `lm_spaces` (espace) |
| Expéditeur | `lm_sender_profiles` |
| Campagne | `lm_campaigns` |
| Cibler / Trouver / Rédiger / Contacter | étapes `target` / `discover` / `write` / `contact` |
| Prise de contact, formulaire | `lm_attempts` |
| Pilote automatique | `lm_autopilots` |
| Liste d'opposition (« ne plus contacter ») | `lm_suppressions` |
