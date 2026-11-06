# Robots Prospectigo

Processus Python (Playwright) qui exécutent les tâches de la file `public.lm_tasks`. Vue d'ensemble et règles
(stabilité, jamais de relance sans « oui » de Gabriel) : `docs/prospectigo/ARCHITECTURE.md` et `workers/AGENTS.md`.

| Type de tâche | Ce que fait le robot |
|---|---|
| `estimate` | Mesure la difficulté d'une campagne (30 recherches au plus, sans ouvrir de fiche) → tarif de 1 à 4 crédits par prospect |
| `discovery` | Recherche les entreprises d'une campagne (planifiée par `lm_schedule_discovery`), écarte administrations, banques et chaînes, enregistre un prospect par site (`lm_record_prospect`, débit des crédits) |
| `prepare` | Ouvre le site du prospect, trouve et remplit le formulaire de contact, prend une capture ; rien n'est envoyé |
| `emails` | Cherche l'adresse e-mail du site (accueil, contact, mentions légales) |
| `send` | Rouvre le formulaire validé, le remplit, clique sur Envoyer ; un envoi interrompu passe « à vérifier », jamais renvoyé automatiquement |

Points communs :
- chaque site est traité dans un processus et un navigateur neufs (`outreach/site_job.py`, coupé après
  `PREPARE_TIMEOUT`) ;
- **garde réseau** `outreach/netguard.py` : seuls les sites web publics sont ouverts (jamais 127.0.0.1,
  169.254.169.254, réseaux privés, `file://`…) ;
- **seuls les formulaires de contact** sont remplis : un formulaire de devis / réservation / rendez-vous (adresse
  `/devis`…, titre « Devis gratuit », bouton « Recevoir mon devis », champs « type de travaux », « budget »,
  « adresse du chantier »…) ou sans zone de message (demande de rappel) est écarté, et le robot cherche ailleurs ;
  même un titre mixte (« Devis / Contact ») ou le titre de la section au-dessus (« Obtenir un devis », y compris
  les 2 titres d'avant s'ils sont tout près, et un texte écrit en très gros sans balise de titre), une promesse de
  rappel (« Nous vous rappelons ») ou une demande de projet (« Parlons projet », champ « Votre projet ») ; une page qui
  porte un formulaire de devis est écartée en entier ; sinon « pas de formulaire » (« formulaire de devis, pas de
  formulaire de contact »). Même règle à l'envoi. Un champ au libellé inconnu n'est jamais rempli. Listes et boutons
  radio : jamais devis, tarif, rendez-vous, commande, SAV, candidature, particulier, et jamais un choix au hasard
  (seulement partenariat, prospection, commercial, information, contact, autre, professionnel : `pick_option`) ;
- captcha de la recherche : le robot attend 30, puis 60, 120, 240 min (`BLOCK_BACKOFF_MINUTES`) ;
- proxy : seule la recherche (`estimate`, `discovery`) passe par `PROXY_URL` ; plafond quotidien
  `PROXY_DAILY_BUDGET_GB` (heure de Paris), réglé par `scripts/set-proxy-budget.sh <Go>` ; consommation :
  `scripts/proxy_usage.py`.

## Où tournent les robots

| Machine | Services (docker compose) |
|---|---|
| Serveur principal « leadmaker-robots-1 » (Hetzner) | `estimate` ×1, `discovery` ×6, `prepare` ×6 (prépare + e-mails), `watch` (surveillant) |
| Serveur d'envoi « leadmaker-envoi-1 » (profil `send`) | `send` × `SEND_REPLICAS` (30 sur ce serveur), `watch-send` |
| Mac dédié de l'équipe | jusqu'à 4 robots de recherche sans proxy pour les campagnes « recherche sur l'ordinateur dédié » |

Base de données : pooler Supabase en **mode transaction** (port 6543) ; une requête = une transaction
(`queue.connect`), compatible avec des dizaines de robots.

## Déployer (toujours avec le script)

```bash
./workers/scripts/deploy-robots.sh               # serveur principal
./workers/scripts/deploy-robots.sh --send        # serveur d'envoi
./workers/scripts/deploy-robots.sh --all         # les deux
./workers/scripts/deploy-robots.sh --rollback    # version précédente (serveur principal) ; --rollback-send
```

La nouvelle version est copiée à côté de l'ancienne, construite, testée en vrai (`leadmaker_workers/selftest.py` :
base, recherche par le proxy, visite d'un site) ; si le test échoue, rien ne change. Ensuite : vérifier 10 minutes
(tâches en échec, prospects qui arrivent). Un seul changement de robot à la fois.

Suivi sur un serveur : `docker compose ps`, `docker compose logs -f prepare`. Couper l'envoi :
`docker compose --profile send stop send` (serveur d'envoi). Nombre de robots d'envoi : `scripts/send-robots.sh N`.

Surveillant (`watchdog.py`, services `watch` / `watch-send`) : alerte par e-mail (Resend, `RESEND_API_KEY`,
`ALERT_EMAIL`, réglés par `scripts/set-alert-email.sh`) quand des tâches n'avancent plus ou que la base ne répond pas.

## Recherche sur l'ordinateur dédié (sans proxy)

Un utilisateur autorisé (table `lm_local_discovery_users`) active « Recherche sur l'ordinateur dédié » sur une
campagne. Les serveurs laissent alors ses recherches de côté et le Mac les fait par sa propre connexion
(`LOCAL_DISCOVERY=1` → `lm_claim_local_task`, hors plafond proxy). Un veilleur (`local_launcher.py`, lancé par launchd)
regarde toutes les 15 s s'il y a du travail et lance / arrête les robots (`MAC_ROBOTS`, 4 par défaut).
Installation une fois par Mac : `./workers/scripts/install-mac-launcher.sh` (retrait : `… uninstall`).
Commandes manuelles : `./workers/scripts/run-mac-discovery.sh [start N | status | stop]` (4 robots par défaut).

## Lancer en local

```bash
cd workers
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/playwright install chromium
./run-local.sh      # robots sur le Supabase local ; SEND_WORKER=1 ./run-local.sh pour activer l'envoi
```

Site de test (formulaire fictif qui enregistre ce qu'il reçoit) : http://formulaire-test.localhost:8089/ (messages reçus
sur /recus), lancé par `run-local.sh`. En local, `NETGUARD_ALLOW_PRIVATE=1` laisse la garde réseau ouvrir ces faux
sites ; ne jamais poser cette variable sur un serveur.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | connexion Postgres (serveurs : pooler port 6543) |
| `WORKER_KINDS` | types de tâches pris (`estimate,discovery`, `prepare,emails`, `send`) |
| `WORKER_ID`, `WORKER_IDLE_SECONDS` | nom du robot ; attente quand la file est vide (5 s) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | dépôt des captures d'écran (bucket `lm_screenshots`) |
| `PROXY_URL` | proxy de la recherche ; `PROXY_DAILY_BUDGET_GB` plafond quotidien (3 Go par défaut) |
| `OUTREACH_PROXY_URL` | proxy facultatif pour la préparation / l'envoi (vide = connexion directe) |
| `PREPARE_TIMEOUT`, `SITE_SOFT_DEADLINE`, `EMAILS_TIMEOUT` | délais par site (100 s, 70 s, …) |
| `SCRAPE_DELAY`, `FAST_SCROLL`, `BLOCK_BACKOFF_MINUTES` | rythme de la recherche, défilement rapide, attente après captcha |
| `HEADLESS=false` | voir le navigateur (en local) |
| `LOCAL_DISCOVERY`, `MAC_ROBOTS`, `LAUNCHER_CHECK_SECONDS` | Mac dédié |
| `RESEND_API_KEY`, `ALERT_EMAIL`, `ALERT_FROM`, `WATCH_*` | surveillant |
| `SEND_REPLICAS`, `ROBOT_IMAGE_TAG` | docker compose |
| `NETGUARD_ALLOW_PRIVATE` | **local uniquement** |

## Données de référence et outils

```bash
python scripts/load_categories.py      # catalogue des activités
python scripts/load_geonames.py        # villes et pays (GeoNames)
```

Banc de test des formulaires : `scripts/formbench.py sites.txt -o data/bench/run.json -j 8` (mode préparation, rien
n'est envoyé ; `--compare avant.json apres.json`). `scripts/formdiag.py` décrit ce qu'une page contient pour comprendre
un échec.
