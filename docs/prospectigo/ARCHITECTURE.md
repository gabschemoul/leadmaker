# Prospectigo — architecture et règles de travail

**À lire en premier par toute IA qui travaille sur ce dépôt.** Le reste de `docs/` (hors `docs/prospectigo/`)
est la documentation générique du kit MakerKit sur lequel l'appli est construite.

Dernière mise à jour : 9 novembre 2026 (crédit unique ; audit complet : `docs/prospectigo/AUDIT-2026-11-05.md`).

---

## 1. Ce que fait Prospectigo

SaaS B2B vendu dans le monde entier (facturation en dollars). Un client (agence, indépendant, PME) :

1. **Cible** : choisit une zone (pays, villes, rayon) et des activités (plombiers, dentistes…) + des filtres
   (note moyenne, nombre d'avis, avec / sans site web).
2. **Trouve** : une *campagne* lance des recherches ; le tri IA ne garde que les entreprises qui correspondent à
   la cible ; chaque entreprise **gardée** devient un *prospect* et coûte des **crédits** (1, 2 ou 4 selon la
   difficulté, voir §7). Les entreprises écartées sont gratuites.
3. **Rédige** : écrit 1 à 4 messages (variables `{company}`, `{city}`…).
4. **Contacte** : des robots ouvrent le site de chaque prospect, remplissent son formulaire de contact et
   l'envoient. **Les envois sont gratuits** (la prise de contact est comprise dans le crédit de l'entreprise
   gardée). Par défaut le **pilote automatique** enchaîne préparation et envoi ; le mode **avancé** laisse valider
   formulaire par formulaire.

Vocabulaire client (crédit unique depuis le 9/11/2026) : un seul mot, **« crédits »** (en anglais « credits »),
« prospects », « prises de contact » (l'action de contacter). Ne plus jamais écrire « crédits de prospection » ni
« crédits de prise de contact ». Fondateurs : Gabriel et Nath (non développeurs). Toute l'interface est en français et en anglais.

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
   • serveur principal : estimate ×1, discovery ×6, prepare ×6, sort ×4 (tri IA), watch (surveillant)
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
| `apps/web/supabase/schemas/20-37-leadmaker-*.sql` | **Source de vérité** du modèle de données (voir §5) |
| `apps/web/supabase/tests/database/leadmaker-*.test.sql` | Tests pgTAP (isolation, crédits, découverte, envoi, pilote, audit) |
| `workers/leadmaker_workers` | Robots : `main.py` (boucle), `queue.py`, `discovery/` (recherche), `outreach/` (formulaires), `watchdog.py` |
| `workers/scripts` | Déploiement et exploitation (deploy-robots.sh, set-proxy-budget.sh…) |
| `ROADMAP.md` | Feuille de route vivante (décisions datées) |

Tout le reste (`packages/`, auth, comptes, facturation générique) est du MakerKit d'origine : n'y toucher que si
nécessaire, pour garder les mises à jour du kit faciles (remote git `upstream`).

## 5. Modèle de données (schémas 20 à 37)

| Fichier | Contenu |
|---|---|
| 20 enums | statuts (campagne, tâche, tentative…) |
| 21 plans | `lm_plans`, `lm_account_credits`, `lm_credit_ledger`, `lm_debit_credits`, `lm_reset_credits`, `lm_refill_credits`, `lm_member`, `lm_has_plan` |
| 22 spaces | espaces (dossiers clients) et expéditeurs |
| 23 campaigns | `lm_campaigns`, `lm_searches`, normalisation des filtres |
| 24 prospects | prospects, **lien campagne ↔ entreprise** (`lm_campaign_prospects` : une entreprise dans plusieurs campagnes de son espace, tri, crédits), tentatives (`lm_attempts`), réponses, listes d'opposition, `lm_clean_website`, `lm_site_suppressed` |
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
| 35 notifications | e-mails de notification |
| 37 sort | **tri IA** : `lm_enqueue_sort` (déclencheur : toute entreprise ajoutée à une campagne qui a une cible en mots), `lm_start_sort` (fixe la cible / l'offre, met en file, robots seulement pour l'instant), `lm_finish_sort` (avis gardee / a_verifier / ecartee pour la version de cible en cours) |
| 36 places | **annuaire commun** à tous les clients : `lm_places` (toutes les fiches vues, infos publiques), `lm_place_searches` (registre pays × activité × zone), `lm_record_search_places` appelée par le robot de recherche à chaque recherche. Illisible par les clients |

Hiérarchie : organisation (compte d'équipe MakerKit) → espace → campagne → zones × activités → recherches →
prospects → tentatives (prises de contact) → pilote automatique.
Une entreprise (`lm_prospects`, unique par espace et par site) peut appartenir à plusieurs campagnes de son espace
(`lm_campaign_prospects`) ; `lm_prospects.campaign_id` = campagne qui l'a trouvée en premier (encore lu par les écrans).
Elle n'est contactée qu'une fois par équipe (`lm_attempts` unique sur espace + prospect).

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
Types : `estimate` (priorité 10), `discovery`, `prepare`, `emails`, `send`, `sort` (tri IA). Un robot réclame une tâche avec
`lm_claim_task(kinds, worker_id)` (SKIP LOCKED), puis `lm_complete_task` / `lm_fail_task` (nouvel essai avec
attente exponentielle). `lm_requeue_stale_tasks` reprend les tâches abandonnées. Compteur `in_flight` d'une
activité = nombre de ses tâches `queued` + `running`, rien d'autre. Un envoi n'est **jamais** réessayé
automatiquement (passe « à vérifier »).

Robots de prise de contact : chaque site est traité dans un processus et un navigateur neufs
(`outreach/site_job.py`), avec la **garde réseau** `outreach/netguard.py` (sites web publics uniquement).

## 7. Crédits et argent

- **Crédit unique (9/11/2026)** : un seul solde, `lm_account_credits.discovery_balance` (type de crédit
  `discovery`), appelé « crédits » dans l'interface. **1 crédit = 1 entreprise gardée, prise de contact comprise.**
  `outreach_balance` / `lm_plans.outreach_credits` ne sont plus ni lus ni débités ni affichés (colonnes gardées tant
  que l'ancien code peut tourner) ; `lm_outreach_balance` renvoie « illimité » avec forfait, 0 sans.
- Forfaits (`lm_plans.discovery_credits`) : Growth 499 $ → 15 000 crédits, Business 990 $ → 40 000,
  Scale 1 999 $ → 100 000 par mois ; annuel = 10 mois payés. Sièges 1/3/6, campagnes actives 1/3/10, budget proxy
  50/100/200 Go. Packs de crédits supplémentaires : pas encore créés (prix à valider par Gabriel).
- **Recharge** : webhook Stripe → `plan-credits.service.ts` → `lm_reset_credits` (idempotent par abonnement +
  période + forfait). Changement de forfait en cours de période = seulement la différence. Forfaits annuels :
  recharge mensuelle par `lm_refill_credits` (pg_cron « lm-refill-credits », toutes les heures).
- **Débits** : campagne avec une cible en mots (tri IA) : rien à la découverte, débit quand l'entreprise passe en
  « gardée » (par l'IA ou le client, `lm_settle_kept`), jamais deux fois par équipe. Campagne sans cible (ancien
  parcours) : débit à l'enregistrement (`lm_record_prospect`, × `credits_per_prospect`). **Aucun débit à l'envoi.**
  Journal : `lm_credit_ledger` (unique par `event_ref`).
- **Prix d'une entreprise gardée** (campagne triée) : mesuré sur les ~300 premières entreprises triées
  (`lm_measure_sort_price`, paliers `sort_credit_tiers`) selon la part gardée par le tri IA : 25 % ou plus → 1 crédit,
  12 à 25 % → 2, 6 à 12 % → 4 ; puis figé. **Sous 6 % : pause** avec la raison `too_hard` (`filters.paused_reason`,
  l'interface demande de préciser la cible). Les gardées pendant la mesure sont payées au palier final.
  Campagne sans cible : tarif mesuré par une estimation (part qui passe les filtres → 1 à 4 crédits), 1 crédit
  (`price_pending`) le temps de la mesure.
- Raisons de pause affichées : `no_credits` (plus de crédits) et `too_hard` (cible trop difficile).
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
- `workers/scripts/sort_campaign.py lancer|bilan "<campagne>"` : tri IA d'une campagne (cible, offre, échantillon) et son bilan.

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
