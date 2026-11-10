-- Vitesse de la page Prospects (10/11/2026) : index du tri par défaut + total, compteurs des filtres sans
-- évaluer la règle d'accès fiche par fiche. Compatible avec le code de main (mêmes noms, mêmes résultats).

-- Liste Prospects (10/11/2026) : tri par défaut (date desc, valeurs vides en fin, id) sur les fiches non exclues,
-- et total exact en lecture d'index seule (account_id inclus pour la règle d'accès). Sans lui, la page lisait les
-- 229 000 fiches deux fois (1,2 s, jusqu'au délai de 8 s en charge).
create index if not exists ix_lm_prospects_space_list
  on public.lm_prospects (space_id, created_at desc nulls last, id) include (account_id)
  where excluded_at is null;

-- Compteurs des filtres Prospects (activités, villes, campagnes) d'un espace.
-- Appelant : appli (utilisateur connecté). Sécurité : security definer pour ne pas évaluer la règle d'accès sur
-- chaque fiche (1,3 s → 0,4 s sur 229 000 fiches, 10/11/2026) ; l'appartenance est vérifiée une fois avec
-- lm_member sur l'organisation de l'espace : sinon aucune ligne.
create or replace function public.lm_prospect_facets(p_space_id uuid)
returns table (kind text, value text, total bigint)
set search_path = ''
language sql
stable
security definer
as $$
  with allowed as (
    select s.id from public.lm_spaces s where s.id = p_space_id and public.lm_member(s.account_id)
  )
  select 'category', p.category, count(*) from public.lm_prospects p
   where p.space_id = (select id from allowed) and p.category is not null group by p.category
  union all
  select 'city', p.city, count(*) from public.lm_prospects p
   where p.space_id = (select id from allowed) and p.city is not null group by p.city
  union all
  select 'campaign', c.id::text, count(*) from public.lm_prospects p
    join public.lm_campaigns c on c.id = p.campaign_id
   where p.space_id = (select id from allowed) group by c.id
  order by 1, 3 desc, 2;
$$;

revoke all on function public.lm_prospect_facets(uuid) from public;

grant execute on function public.lm_prospect_facets(uuid) to authenticated, service_role;
