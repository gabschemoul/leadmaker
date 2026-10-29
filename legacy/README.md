# Legacy — prototype interne (référence, ne pas exécuter depuis ici)

Copie du prototype « Scraper Google Maps + Bot de contact » (variante États-Unis) utilisé en interne
par Review Cleaner. Il sert de référence pour la logique à réutiliser dans le SaaS :

- `gmb-scraper-us/formfill.py` — recherche du formulaire de contact, classification des champs, remplissage, soumission
- `gmb-scraper-us/scraper.py` — pilotage Google Maps (Playwright), pré-filtrage sur la carte
- `gmb-scraper-us/exclusions.py`, `sites.py`, `categories.py` — exclusions, dédoublonnage par site, catégories Google
- `gmb-scraper-us/crawler.py`, `contact_bot.py` — orchestration mono-Mac (à réécrire, voir cahier des charges §6)
- `gmb-scraper-us/data/` — 4 053 catégories Google, 20 813 villes US, catégories génériques

Secrets, bases SQLite, captures et environnement virtuel ont été exclus volontairement.

Documents de cadrage : `01-…` (outil interne, état réel), `02-…` (vision), `03-…` (consolidation de l'associé).
Le cahier des charges de référence est le document partagé : https://claude.ai/artifact/SqskF2RvHvw3vFRMLsCPyz
