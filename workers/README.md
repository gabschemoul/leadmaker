# Workers LeadMaker

Processus Python qui exécutent les tâches de la file `public.lm_tasks` : découverte Google Maps,
préparation et envoi des formulaires. Lot 0 : boucle de base et tâche factice `dummy`.

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

## Charger les villes GeoNames

```bash
python scripts/load_geonames.py        # télécharge cities500 et countryInfo, remplit lm_geo_cities et lm_country_coverage
```
