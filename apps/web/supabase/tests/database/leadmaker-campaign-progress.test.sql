-- 3/11/2026 : la page d'une grosse campagne tombait en erreur (délai de la base dépassé) car l'avancement
-- (lm_campaign_progress) vérifiait les droits ligne par ligne sur 16 000 quartiers et 24 000 crédits.
-- Il vérifie désormais les droits une fois (SECURITY DEFINER) : mêmes chiffres, même isolement.
begin;

select no_plan();

select tests.create_supabase_user('pg_a', 'pg_a@test.com');
select tests.create_supabase_user('pg_b', 'pg_b@test.com');

set local role service_role;
select public.create_team_account('PG A', tests.get_supabase_uid('pg_a'), 'pg-a');
select public.create_team_account('PG B', tests.get_supabase_uid('pg_b'), 'pg-b');
set local role postgres;

insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded) values
  ('gcid:pg_a', 'PG alpha', 'PG alpha', 'Test', false, false),
  ('gcid:pg_b', 'PG bravo', 'PG bravo', 'Test', false, false)
on conflict do nothing;

insert into public.lm_campaigns (id, account_id, space_id, name, country_code)
select 'a0000000-0000-4000-8000-0000000c0001', a.id,
       (select s.id from public.lm_spaces s where s.account_id = a.id and s.is_default), 'Avancement', 'FR'
  from public.accounts a where a.slug = 'pg-a';

insert into public.lm_geo_cities (geoname_id, name, ascii_name, country_code, population, latitude, longitude)
values (990000301, 'Progressville', 'Progressville', 'FR', 1000, 45.0, 4.0) on conflict do nothing;

insert into public.lm_campaign_zones (campaign_id, idx, pos, account_id, geoname_id, label, population, removed)
select 'a0000000-0000-4000-8000-0000000c0001', i, i, (select id from public.accounts where slug = 'pg-a'),
       990000301, 'Zone ' || i, 1000, i = 2
  from generate_series(0, 2) i;

insert into public.lm_campaign_categories (campaign_id, gcid, account_id, searches, in_flight, kept, cards)
select 'a0000000-0000-4000-8000-0000000c0001', g, (select id from public.accounts where slug = 'pg-a'), 3, 1, 2, 40
  from (values ('gcid:pg_a'), ('gcid:pg_b')) v(g);

insert into public.lm_credit_ledger (account_id, kind, delta, reason, campaign_id, event_ref)
select (select id from public.accounts where slug = 'pg-a'), 'discovery', -1, 'prospect',
       'a0000000-0000-4000-8000-0000000c0001', 'pg:prospect:' || i
  from generate_series(1, 5) i;

select ok((select prosecdef from pg_proc where oid = 'public.lm_campaign_progress(uuid)'::regprocedure),
  'L''avancement vérifie les droits une fois (SECURITY DEFINER), pas ligne par ligne');

-- Membre de l'organisation : les vrais chiffres
select makerkit.authenticate_as('pg_a');
select is((select (zones, categories, searches_total, searches_done, in_flight, productive, prospects, cards)::text
             from public.lm_campaign_progress('a0000000-0000-4000-8000-0000000c0001')),
  '(2,2,4,6,2,2,5,80)', 'Le membre voit l''avancement exact (ville retirée exclue, 5 prospects débités)');

-- Autre organisation : rien
select makerkit.authenticate_as('pg_b');
select is((select count(*)::int from public.lm_campaign_progress('a0000000-0000-4000-8000-0000000c0001')), 0,
  'Une autre organisation ne voit rien de l''avancement');
set local role postgres;

-- Campagne inexistante : rien
select is((select count(*)::int from public.lm_campaign_progress('a0000000-0000-4000-8000-0000000c0999')), 0,
  'Campagne inexistante : aucun chiffre');

select ok(not has_function_privilege('anon', 'public.lm_campaign_progress(uuid)', 'EXECUTE'),
  'Les visiteurs non connectés ne peuvent pas appeler l''avancement');

select * from finish();

rollback;
