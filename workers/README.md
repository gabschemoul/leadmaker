# Workers LeadMaker

Processus Python qui exécutent les tâches de la file `public.lm_tasks` : découverte Google Maps (lot 1),
préparation et envoi des formulaires (lot 2).

Découverte : le worker planifie lui-même les recherches des campagnes en cours (`lm_schedule_discovery`),
lit Google Maps (interface en anglais, résultats orientés sur le pays de la campagne), écarte administrations,
banques et chaînes, enregistre un prospect par site et débite un crédit découverte par prospect retenu.
Un captcha Google met le worker en pause 30 min, puis 60, 120 et 240 min.

Préparation des formulaires (`WORKER_KINDS=prepare`) : pour chaque tentative en attente, le worker ouvre le site du
prospect dans un processus à part (coupé après `PREPARE_TIMEOUT`, 100 s ; une page qui ne répond plus est abandonnée
après `SITE_SOFT_DEADLINE`, 70 s, en gardant les e-mails relevés), trouve le formulaire de contact, le remplit
avec le profil expéditeur et un message tiré en rotation équilibrée, prend une capture (bucket `lm_screenshots`,
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` requis) et enregistre le résultat : prêt, à compléter, intervention requise
(captcha détecté par type, jamais résolu ici), pas de formulaire, inaccessible. Rien n'est envoyé à cette étape.

Envoi (`WORKER_KINDS=send`) : le worker met lui-même en file les tentatives validées (`lm_queue_sends`, limites
quotidiennes par campagne et par forfait, crédits outreach), rouvre le formulaire, le remplit avec les valeurs validées,
clique sur Envoyer, prend une capture après envoi et enregistre envoyé / à vérifier / échec. Jamais deux envois pour
une même tentative : un envoi interrompu passe « à vérifier ». En local, `run-local.sh` ne lance ce worker que si
`SEND_WORKER=1`. Site de test : `scripts/test_contact_site.py` (http://formulaire-test.localhost:8089/, messages reçus
sur /recus) — un prospect « Plomberie Test (site fictif LeadMaker) » existe dans les organisations de test.

Variables utiles : `WORKER_KINDS=discovery`, `HEADLESS=false` pour voir le navigateur, `SCRAPE_DELAY` (1,5 s),
`PROXY_URL=http://user:pass@hote:port` pour passer par un fournisseur de proxies.

## Lancer en local

```bash
cd workers
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # DATABASE_URL pointe sur le Supabase local
set -a; source .env; set +a
python -m leadmaker_workers.main
```

## Serveur (Hetzner, Docker)

Les robots tournent sur un serveur Hetzner (Ubuntu 24.04, CX32 : 4 vCPU / 8 Go pour une dizaine de robots).
Mise en place, une seule fois :

Serveur « leadmaker-robots-1 » (2.31.72.125, Falkenstein), créé par l'API Hetzner, clé SSH `~/.ssh/leadmaker_hetzner`
sur le Mac de Gabriel. Le dépôt GitHub est privé : le code des robots est copié depuis le Mac (rsync), pas cloné.

```bash
# depuis le Mac, à la racine du dépôt : copie du code des robots (sans secrets ni données locales)
rsync -az -e "ssh -i ~/.ssh/leadmaker_hetzner" --exclude .venv --exclude logs --exclude data/bench \
  --exclude '.env*' --exclude '.hetzner*' --exclude '.dataimpulse' --exclude __pycache__ \
  workers/ root@2.31.72.125:/opt/leadmaker/workers/
# sur le serveur : /opt/leadmaker/workers/.env contient les variables (modèle : .env.server.example)
ssh -i ~/.ssh/leadmaker_hetzner root@2.31.72.125 'cd /opt/leadmaker/workers && docker compose up -d --build prepare'
```

`docker compose up -d --build` (sans nom de service) lance aussi les robots Google Maps (estimations, découverte) :
à ne faire qu'avec `PROXY_URL` renseigné, sinon Google bloque l'adresse du serveur. Mise à jour : refaire le rsync puis
`docker compose up -d --build`.
Base de données : les robots passent par le pooler Supabase en MODE TRANSACTION (port 6543, `scripts/switch-db-transaction-mode.sh`) : une connexion Postgres est partagée entre plusieurs robots. En mode session (5432), chaque robot garde sa connexion et la base Micro (60 max) sature au-delà de ~25 robots. `scripts/send-robots.sh N` règle le nombre de robots d'envoi.
Proxy : seule la recherche Google Maps passe par PROXY_URL (préparation, e-mails, envoi sortent en direct). Chaque recherche mesure ses octets (`proxy_bytes` dans le résultat de la tâche) ; plafond quotidien PROXY_DAILY_BUDGET_GB (3 Go par défaut, heure de Paris) au-delà duquel les recherches attendent le lendemain. Consommation : `scripts/proxy_usage.py`. Changer de forfait : `scripts/set-proxy.sh`.
Robot d'envoi : serveur dédié « leadmaker-envoi-1 » (cx53, créé par `scripts/setup-send-server.sh`, SEND_REPLICAS=30 dans son .env). Mise à jour : `scripts/deploy-robots.sh --send` (ou `--all`). Pour couper l'envoi : `docker compose --profile send stop send` sur ce serveur.
Suivi : `docker compose ps`, `docker compose logs -f prepare`. Chaque robot finit sa tâche en cours avant de s'arrêter.

## Recherche sur un ordinateur dédié (sans proxy)

Pour ne pas payer le proxy sur une campagne, un utilisateur autorisé (table `lm_local_discovery_users`, à remplir en
SQL) active « Recherche sur l'ordinateur dédié » sur la page de la campagne. Les robots des serveurs laissent alors ses
recherches Google Maps de côté (`lm_claim_task`) et le robot du Mac les fait par la connexion du Mac
(`LOCAL_DISCOVERY=1` → `lm_claim_local_task`, jamais de proxy, trafic rangé dans `local_bytes`, hors plafond).
Le surveillant ignore ces campagnes. Estimations, préparation et envoi restent sur les serveurs.

Le robot se lance TOUT SEUL : un veilleur (`leadmaker_workers/local_launcher.py`, démarré avec la session par
launchd) regarde toutes les 15 s si une campagne en cours est marquée, lance 4 robots si oui (relance ceux qui
s'arrêtent ; `MAC_ROBOTS` pour changer le nombre) et les arrête sinon.
Installation une fois par Mac : `./workers/scripts/install-mac-launcher.sh` (retrait : `… uninstall`,
journal : `workers/logs/mac-launcher.log`). Commandes manuelles du robot, si besoin :

```bash
./workers/scripts/run-mac-discovery.sh          # lance 1 robot sur la vraie base (workers/.env.cloud)
./workers/scripts/run-mac-discovery.sh status   # en marche ? dernières lignes du journal
./workers/scripts/run-mac-discovery.sh stop     # arrêt propre
```

## Charger les données de référence

```bash
python scripts/load_categories.py      # 4 053 catégories Google (générales, exclues)
```

## Charger les villes GeoNames

```bash
python scripts/load_geonames.py        # télécharge cities500 et countryInfo, remplit lm_geo_cities et lm_country_coverage
```

Recherche d'e-mails (`WORKER_KINDS=emails`, assurée par les mêmes workers que la préparation) : visite l'accueil, les pages
contact et mentions légales du site et enregistre l'adresse du domaine du site (ou d'une messagerie grand public), jamais
celle d'une autre société.

Banc de test de la recherche de formulaires : `scripts/formbench.py sites.txt -o data/bench/run.json -j 8` rejoue le robot
(mode préparation, rien n'est envoyé) sur une liste de sites et résume les statuts ; `--compare avant.json apres.json`
montre les changements, `--previous run.json --only no_form,timeout` ne rejoue que certains statuts. `scripts/formdiag.py`
décrit ce qu'une page contient (formulaires, champs, iframes, liens contact) pour comprendre un échec.
