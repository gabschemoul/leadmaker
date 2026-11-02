"""Vide la file de recherches Google Maps des campagnes en cours pour laisser le planificateur
(roadmap n°12 : activités qui rapportent d'abord) la reconstituer.

Usage (depuis la racine du dépôt, base en ligne via workers/.env.cloud) :
    workers/.venv/bin/python -I workers/scripts/replan_discovery.py            # affiche ce qui serait vidé
    workers/.venv/bin/python -I workers/scripts/replan_discovery.py --apply    # vide pour de bon

Ce que ça fait, par campagne en cours :
- supprime les recherches EN ATTENTE (status queued) ; celles en cours de traitement continuent ;
- pour chaque activité concernée, libère ses places (in_flight) et ramène son curseur de zone
  au premier quartier supprimé, pour qu'il soit rejoué plus tard si l'activité le mérite.
Rien d'autre ne bouge : prospects, crédits, recherches déjà faites, rendement des activités.
Les robots recréent la file en quelques secondes (lm_schedule_discovery) selon les nouvelles règles.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg


def database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = Path(__file__).resolve().parents[1] / ".env.cloud"
    for line in env.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("DATABASE_URL introuvable dans workers/.env.cloud")


PREVIEW = """
select c.name, count(*) as en_attente,
       count(*) filter (where cc.searches = 0) as sur_activites_jamais_essayees
  from public.lm_tasks t
  join public.lm_campaigns c on c.id = (t.payload ->> 'campaign_id')::uuid
  join public.lm_campaign_categories cc on cc.campaign_id = c.id and cc.gcid = t.payload ->> 'gcid'
 where t.kind = 'discovery' and t.status = 'queued' and c.status = 'running'
 group by c.name order by 2 desc
"""

APPLY = """
with dropped as (
  delete from public.lm_tasks t
   using public.lm_campaigns c
   where t.kind = 'discovery' and t.status = 'queued'
     and c.id = (t.payload ->> 'campaign_id')::uuid and c.status = 'running'
  returning c.id as campaign_id, c.name, t.payload ->> 'gcid' as gcid, (t.payload ->> 'zone_idx')::int as zone_idx
), per_category as (
  update public.lm_campaign_categories cc
     set in_flight = greatest(cc.in_flight - d.n, 0),
         next_zone_idx = least(cc.next_zone_idx, d.first_zone)
    from (select campaign_id, gcid, count(*) as n, min(zone_idx) as first_zone from dropped group by 1, 2) d
   where cc.campaign_id = d.campaign_id and cc.gcid = d.gcid
  returning 1
)
select name, count(*) from dropped group by name order by 2 desc
"""


def main() -> None:
    apply = "--apply" in sys.argv[1:]
    with psycopg.connect(database_url(), prepare_threshold=None) as conn:
        rows = conn.execute(PREVIEW).fetchall()
        if not rows:
            print("Aucune recherche en attente sur les campagnes en cours : rien à faire.")
            return
        for name, waiting, untried in rows:
            print(f"{name} : {waiting} recherches en attente, dont {untried} sur des activités jamais essayées")
        if not apply:
            print("\nAperçu seulement. Relancer avec --apply pour vider la file.")
            return
        for name, n in conn.execute(APPLY).fetchall():
            print(f"{name} : {n} recherches retirées de la file")
        conn.commit()
        print("File vidée : les robots la reconstituent avec les nouvelles règles.")


if __name__ == "__main__":
    main()
