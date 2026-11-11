"""Remet à zéro la recherche Google Maps d'une campagne, pour la relancer depuis le début.

Usage (depuis la racine du dépôt, base en ligne via workers/.env.cloud) :
    workers/.venv/bin/python -I workers/scripts/reset_campaign_search.py "Nom de la campagne" slug-de-l-equipe

- efface les recherches déjà faites de la campagne et remet ses activités au début (non abandonnées) ;
- « oublie » les fiches Google vues pendant ces recherches et écartées (sinon le robot ne les rouvre pas) ;
  les fiches devenues prospects ne sont pas touchées ;
- met la campagne en pause : cliquer ensuite sur « Reprendre » dans l'app.
Les prospects déjà trouvés et les crédits ne bougent pas.

⚠ Agit sur la PROD : à lancer seulement sur demande explicite de Gabriel.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg


def database_url() -> str:
    env = Path(__file__).resolve().parents[1] / ".env.cloud"
    for line in env.read_text().splitlines():
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"')
    sys.exit("DATABASE_URL introuvable dans workers/.env.cloud")


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    name, slug = sys.argv[1], sys.argv[2]
    with psycopg.connect(database_url(), prepare_threshold=None) as conn:
        row = conn.execute(
            """select c.id, c.space_id, c.status from public.lm_campaigns c
                 join public.accounts a on a.id = c.account_id
                where c.name = %s and a.slug = %s""",
            (name, slug),
        ).fetchone()
        if not row:
            sys.exit(f"Campagne « {name} » introuvable dans l'équipe {slug}")
        campaign_id, space_id, status = row
        window = conn.execute(
            """select min(created_at) - interval '10 minutes', max(created_at) + interval '2 minutes'
                 from public.lm_searches where campaign_id = %s""",
            (campaign_id,),
        ).fetchone()
        forgotten = 0
        if window[0]:
            forgotten = conn.execute(
                """delete from public.lm_place_sightings ps
                    where ps.space_id = %s and not ps.kept and ps.created_at between %s and %s
                      and not exists (select 1 from public.lm_prospects p
                                       where p.space_id = ps.space_id and p.site_key = ps.site_key)""",
                (space_id, window[0], window[1]),
            ).rowcount
        # Pause par la fonction officielle : recherches en file annulées ET places (in_flight) libérées
        if status == "running":
            conn.execute("select public.lm_pause_campaign(%s, null)", (campaign_id,))
        searches = conn.execute("delete from public.lm_searches where campaign_id = %s", (campaign_id,)).rowcount
        conn.execute(
            """update public.lm_campaign_categories
                  set next_zone_idx = 0, searches = 0, cards = 0, cards_new = 0, kept = 0, abandoned = false,
                      abandon_base_searches = 0, abandon_base_kept = 0
                where campaign_id = %s""",
            (campaign_id,),
        )
        # Les recherches encore en cours finissent ; les places repartent des vraies tâches (règle in_flight)
        conn.execute("select public.lm_recount_in_flight(%s)", (campaign_id,))
        conn.commit()
    print(f"Campagne « {name} » remise à zéro : {searches} recherches effacées, {forgotten} fiches oubliées, "
          f"statut {status} → en pause. Cliquez sur « Reprendre » dans l'app.")


if __name__ == "__main__":
    main()
