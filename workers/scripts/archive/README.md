# Scripts ponctuels archivés

Gardés pour mémoire, plus à lancer en temps normal (ils ont servi une seule fois) :

- `replan_discovery.py` : vidage de la file de recherches lors du passage au planificateur « activités qui
  rapportent » (roadmap n°12, 2/11/2026).
- `retry_failed_searches.py` : relance des recherches en échec ; rendu inutile par la remise en file automatique
  quand le proxy tombe (`main.py`, ProxyDown).
- `switch-db-transaction-mode.sh` : bascule des robots vers le pooler Supabase en mode transaction (port 6543), faite.

Tous agissent sur la PROD : jamais sans demande explicite de Gabriel.
