# Workers LeadMaker

Processus Python qui exécutent les tâches de la file `public.lm_tasks` : découverte Google Maps (lot 1),
préparation et envoi des formulaires (lot 2).

Découverte : le worker planifie lui-même les recherches des campagnes en cours (`lm_schedule_discovery`),
lit Google Maps (interface en anglais, résultats orientés sur le pays de la campagne), écarte administrations,
banques et chaînes, enregistre un prospect par site et débite un crédit découverte par prospect retenu.
Un captcha Google met le worker en pause 30 min, puis 60, 120 et 240 min.

Préparation des formulaires (`WORKER_KINDS=prepare`) : pour chaque tentative en attente, le worker ouvre le site du
prospect dans un processus à part (coupé après `PREPARE_TIMEOUT`, 180 s), trouve le formulaire de contact, le remplit
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

## Conteneur

```bash
docker build -t leadmaker-worker workers/
docker run --env-file workers/.env --network host leadmaker-worker
```

## Charger les données de référence

```bash
python scripts/load_categories.py      # 4 053 catégories Google (générales, exclues)
```

## Charger les villes GeoNames

```bash
python scripts/load_geonames.py        # télécharge cities500 et countryInfo, remplit lm_geo_cities et lm_country_coverage
```
