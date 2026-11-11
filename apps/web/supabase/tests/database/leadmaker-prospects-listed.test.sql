-- 11/11/2026 : la page Prospects ne montre plus les fiches écartées (ou à vérifier, jamais payées) d'une campagne
-- triée (lm_prospects.listed) ; elles restent en base. L'e-mail « recherche terminée » d'une campagne triée annonce
-- les prospects gardés (payload « kept »).
begin;

select no_plan();

select tests.create_supabase_user('pl_owner', 'pl_owner@test.com');
select tests.create_supabase_user('pl_other', 'pl_other@test.com');

set local role service_role;
select public.create_team_account('Pl A', tests.get_supabase_uid('pl_owner'), 'pl-a');
select public.create_team_account('Pl B', tests.get_supabase_uid('pl_other'), 'pl-b');
set local role postgres;

create temp view tpl as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'pl-a';
grant select on tpl to authenticated, service_role;

insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
insert into public.lm_categories (gcid, label_en, label_fr, family) values
  ('gcid:pl_agency', 'PL agency', 'PL agence', 'Test')
on conflict do nothing;
insert into public.lm_account_credits (account_id, plan_id, discovery_balance) select account_id, 'growth', 100 from tpl
on conflict (account_id) do update set plan_id = 'growth', discovery_balance = 100;

insert into public.lm_campaigns (id, account_id, space_id, name, country_code, status)
select x.id, t.account_id, t.space_id, x.name, 'FR', 'running'
  from tpl t, (values ('e9000000-0000-4000-8000-0000000000a1'::uuid, 'Sans cible'),
                      ('e9000000-0000-4000-8000-0000000000b1'::uuid, 'Triée')) x(id, name);

create function pg_temp.listed(p_key text) returns boolean language sql as $$
  select listed from public.lm_prospects where site_key = p_key $$;
create function pg_temp.pid(p_key text) returns uuid language sql as $$
  select id from public.lm_prospects where site_key = p_key $$;
grant execute on function pg_temp.listed(text), pg_temp.pid(text) to service_role, authenticated;

set local role service_role;
select public.lm_record_prospect('e9000000-0000-4000-8000-0000000000a1',
  '{"place_id":"pl:old","name":"Ancienne","site_key":"old.fr","website":"https://old.fr","gcid":"gcid:pl_agency"}');
select ok(pg_temp.listed('old.fr'), 'Campagne sans cible (payée à la découverte) : sur la page Prospects');

select public.lm_start_sort('e9000000-0000-4000-8000-0000000000b1', 'Agences');
select public.lm_record_prospect('e9000000-0000-4000-8000-0000000000b1',
  format('{"place_id":"pl:%s","name":"Entreprise %s","site_key":"%s.fr","website":"https://%s.fr","gcid":"gcid:pl_agency"}', n, n, n, n)::jsonb)
  from unnest(array['k', 'e', 'v']) n;
select ok(not pg_temp.listed('k.fr') and not pg_temp.listed('e.fr') and not pg_temp.listed('v.fr'),
  'Campagne triée : pas sur la page Prospects tant que rien n''est payé');

select public.lm_finish_sort('e9000000-0000-4000-8000-0000000000b1', pg_temp.pid('k.fr'), 1, 'gardee', null, 'ok');
select public.lm_finish_sort('e9000000-0000-4000-8000-0000000000b1', pg_temp.pid('e.fr'), 1, 'ecartee', null, 'non');
select public.lm_finish_sort('e9000000-0000-4000-8000-0000000000b1', pg_temp.pid('v.fr'), 1, 'a_verifier', null, '?');
select ok(pg_temp.listed('k.fr'), 'Gardée donc payée : apparaît sur la page Prospects');
select ok(not pg_temp.listed('e.fr'), 'Écartée : toujours absente de la page Prospects');
select ok(pg_temp.pid('e.fr') is not null, 'Écartée : la fiche reste en base');
select ok(not pg_temp.listed('v.fr'), 'À vérifier : absente tant qu''elle n''est pas gardée');

-- le membre : la page (filtre listed) et les filtres (lm_prospect_facets) ne comptent que les fiches affichées
set local role postgres;
select makerkit.authenticate_as('pl_owner');
select is((select count(*)::int from public.lm_prospects where space_id = (select space_id from tpl) and listed), 2,
  'Page Prospects : 2 fiches (l''ancienne et la gardée)');
select is((select total::int from public.lm_prospect_facets((select space_id from tpl))
            where kind = 'campaign' and value = 'e9000000-0000-4000-8000-0000000000b1'), 1,
  'Filtre par campagne : seulement la gardée de la campagne triée');

-- autre organisation : rien
select makerkit.authenticate_as('pl_other');
select is((select count(*)::int from public.lm_prospect_facets((select space_id from tpl))), 0,
  'Une autre organisation ne voit pas les filtres');
set local role postgres;

-- e-mail « recherche terminée » : le nombre de gardés pour une campagne triée
update public.lm_campaigns set status = 'completed' where id = 'e9000000-0000-4000-8000-0000000000b1';
select is((select (payload ->> 'kept')::int from public.lm_notifications
            where kind = 'search_done' and campaign_id = 'e9000000-0000-4000-8000-0000000000b1'), 1,
  'E-mail de fin : 1 prospect gardé annoncé (et non les 3 fiches trouvées)');
update public.lm_campaigns set status = 'completed' where id = 'e9000000-0000-4000-8000-0000000000a1';
select ok((select not (payload ? 'kept') from public.lm_notifications
            where kind = 'search_done' and campaign_id = 'e9000000-0000-4000-8000-0000000000a1'),
  'Campagne sans cible : pas de nombre de gardés (ancien e-mail)');

select * from finish();

rollback;
