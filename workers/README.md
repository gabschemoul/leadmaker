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

```bash
# sur le serveur, en root
apt-get update && apt-get install -y docker.io docker-compose-v2 git
git clone https://github.com/gabschemoul/leadmaker.git /opt/leadmaker
cd /opt/leadmaker/workers
cp .env.server.example .env   # puis remplir DATABASE_URL (mot de passe de la base), SUPABASE_SERVICE_ROLE_KEY, PROXY_URL
docker compose up -d --build  # 2 estimations, 1 découverte, 6 préparations / e-mails ; l'envoi reste coupé
```

Mise à jour après un `git push` : `cd /opt/leadmaker && git pull && cd workers && docker compose up -d --build`.
Robot d'envoi (décision de Gabriel) : `docker compose --profile send up -d` ; pour le couper : `docker compose stop send`.
Suivi : `docker compose ps`, `docker compose logs -f prepare`. Chaque robot finit sa tâche en cours avant de s'arrêter.

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
