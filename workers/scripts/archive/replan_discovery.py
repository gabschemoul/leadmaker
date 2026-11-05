"""Vide la file de recherches Google Maps des campagnes en cours pour laisser le planificateur
(roadmap n°12 : activités qui rapportent d'abord) la reconstituer.

Usage (depuis la racine du dépôt, base en ligne via workers/.env.cloud) :
    workers/.venv/bin/python -I workers/scripts/replan_discovery.py            # affiche ce qui serait vidé
    workers/.venv/bin/python -I workers/scripts/replan_discovery.py --apply    # vide pour de bon

Ce que ça fait, par campagne en cours OU en pause :
- supprime les recherches en attente (queued) et celles annulées par une pause (cancelled) ;
  celles en cours de traitement continuent ;
- ramène le curseur de zone de chaque activité concernée au premier quartier supprimé,
  pour qu'il soit rejoué plus tard si l'activité le mérite ;
- recompte les places occupées (in_flight) à partir des vraies tâches (lm_recount_in_flight),
  ce qui efface aussi les compteurs fantômes laissés par d'anciennes pauses.
Rien d'autre ne bouge : prospects, crédits, recherches déjà faites, rendement des activités.
Les robots recréent la file en quelques secondes (lm_schedule_discovery) selon les nouvelles règles ;
une campagne en pause repart quand on la relance dans l'app.
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
select c.id, c.name, c.status,
       (select count(*) from public.lm_tasks t
         where t.kind = 'discovery' and t.status in ('queued', 'cancelled')
           and t.payload ->> 'campaign_id' = c.id::text) as a_retirer,
       (select count(*) from public.lm_tasks t
          join public.lm_campaign_categories cc on cc.campaign_id = c.id and cc.gcid = t.payload ->> 'gcid'
         where t.kind = 'discovery' and t.status in ('queued', 'cancelled')
           and t.payload ->> 'campaign_id' = c.id::text and cc.searches = 0) as sur_activites_jamais_essayees,
       (select coalesce(sum(cc.in_flight), 0) from public.lm_campaign_categories cc where cc.campaign_id = c.id) as places_comptees,
       (select count(*) from public.lm_tasks t
         where t.kind = 'discovery' and t.status in ('queued', 'running')
           and t.payload ->> 'campaign_id' = c.id::text) as taches_reelles
  from public.lm_campaigns c
 where c.status in ('running', 'paused')
   and exists (select 1 from public.lm_campaign_categories cc where cc.campaign_id = c.id)
 order by 4 desc, c.name
"""

APPLY = """
with dropped as (
  delete from public.lm_tasks t
   using public.lm_campaigns c
   where t.kind = 'discovery' and t.status in ('queued', 'cancelled')
     and c.id = (t.payload ->> 'campaign_id')::uuid and c.status in ('running', 'paused')
  returning c.id as campaign_id, c.name, t.payload ->> 'gcid' as gcid, (t.payload ->> 'zone_idx')::int as zone_idx
), per_category as (
  update public.lm_campaign_categories cc
     set next_zone_idx = least(cc.next_zone_idx, d.first_zone)
    from (select campaign_id, gcid, min(zone_idx) as first_zone from dropped group by 1, 2) d
   where cc.campaign_id = d.campaign_id and cc.gcid = d.gcid
  returning 1
)
select name, count(*) from dropped group by name order by 2 desc
"""


def main() -> None:
    apply = "--apply" in sys.argv[1:]
    with psycopg.connect(database_url(), prepare_threshold=None) as conn:
        rows = conn.execute(PREVIEW).fetchall()
        todo = [r for r in rows if r[3] > 0 or r[5] != r[6]]
        if not todo:
            print("Rien à retirer et compteurs justes sur les campagnes en cours ou en pause : rien à faire.")
            return
        for _id, name, status, waiting, untried, counted, real in todo:
            print(f"{name} ({status}) : {waiting} recherches à retirer (dont {untried} sur des activités jamais "
                  f"essayées) ; places comptées {counted} pour {real} tâches réelles")
        if not apply:
            print("\nAperçu seulement. Relancer avec --apply pour vider la file et recompter.")
            return
        for name, n in conn.execute(APPLY).fetchall():
            print(f"{name} : {n} recherches retirées de la file")
        for _id, name, *_ in todo:
            fixed = conn.execute("select public.lm_recount_in_flight(%s)", (_id,)).fetchone()[0]
            print(f"{name} : compteurs recalculés ({fixed} activités corrigées)")
        conn.commit()
        print("Fait. Les robots reconstituent la file des campagnes en cours ; relancer les campagnes en pause dans l'app.")


if __name__ == "__main__":
    main()
