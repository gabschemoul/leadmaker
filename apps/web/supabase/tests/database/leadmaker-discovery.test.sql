-- Lot 1 : lancement de campagne, planification, enregistrement des prospects, isolation.
begin;

select no_plan();

select tests.create_supabase_user('disc_a', 'disc_a@test.com');
select tests.create_supabase_user('disc_b', 'disc_b@test.com');

set local role service_role;
select public.create_team_account('Disc A', tests.get_supabase_uid('disc_a'), 'disc-a');
select public.create_team_account('Disc B', tests.get_supabase_uid('disc_b'), 'disc-b');
set local role postgres;

-- Données de référence propres au test (la base de test peut être vide)
insert into public.lm_plans (id, name, seats, spaces, discovery_credits, outreach_credits, daily_send_limit, active_campaigns, auto_validation)
values ('growth', 'Growth', 2, 3, 15000, 5000, 500, 1, false) on conflict (id) do nothing;
insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
insert into public.lm_country_coverage (country_code, name) values ('ZZ', 'Testland') on conflict do nothing;
insert into public.lm_geo_cities (geoname_id, name, ascii_name, country_code, population, latitude, longitude) values
  (990000001, 'Bigtown', 'Bigtown', 'ZZ', 500000, 10.0, 10.0),
  (990000002, 'Smallville', 'Smallville', 'ZZ', 2000, 10.05, 10.05),
  (990000003, 'Faraway', 'Faraway', 'ZZ', 90000, 40.0, 40.0)
on conflict do nothing;
insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded) values
  ('gcid:test_bakery', 'Test bakery', 'Boulangerie test', 'Commerces', true, false),
  ('gcid:test_salon', 'Test salon', 'Salon test', 'Beauté', true, false),
  ('gcid:test_city_hall', 'Test city hall', 'Mairie test', 'Administrations', true, true)
on conflict do nothing;

-- Le test ne doit pas dépendre des campagnes déjà présentes en local
update public.lm_campaigns set status = 'paused' where status = 'running';

select makerkit.authenticate_as('disc_a');

insert into public.lm_spaces (account_id, name, country_code) values ((select id from public.accounts where slug = 'disc-a'), 'Espace A', 'ZZ');

insert into public.lm_campaigns (account_id, space_id, name, country_code, targeting, filters)
values ((select id from public.accounts where slug = 'disc-a'), (select id from public.lm_spaces where name = 'Espace A'),
        'Campagne A', 'ZZ',
        '{"cities":{"mode":"radius","geoname_id":990000001,"radius_km":20},"categories":{"mode":"list","gcids":["gcid:test_bakery","gcid:test_salon","gcid:test_city_hall"]}}',
        '{"rating_min":0.8,"rating_max":3.5}');

-- Estimation : 2 villes dans le rayon, 2 catégories (la mairie est exclue)
select is(
  (select (cities, categories, searches)::text from public.lm_estimate_campaign('ZZ',
     '{"cities":{"mode":"radius","geoname_id":990000001,"radius_km":20},"categories":{"mode":"list","gcids":["gcid:test_bakery","gcid:test_salon","gcid:test_city_hall"]}}')),
  '(2,2,4)', 'Estimation : villes du rayon, catégories exclues retirées');

-- Le statut ne se modifie pas directement
select throws_ok($$ update public.lm_campaigns set status = 'running' where name = 'Campagne A' $$,
  '42501', null, 'Le statut ne peut pas être modifié directement');

-- Sans crédits, le lancement est refusé
select throws_ok($$ select public.lm_start_campaign((select id from public.lm_campaigns where name = 'Campagne A')) $$,
  'P0001', 'no discovery credits', 'Lancement refusé sans crédits');

set local role service_role;
select public.lm_reset_credits((select id from public.accounts where slug = 'disc-a'), 'growth', now() + interval '1 month', 'disc:renewal:a');
set local role postgres;
select makerkit.authenticate_as('disc_a');

select lives_ok($$ select public.lm_start_campaign((select id from public.lm_campaigns where name = 'Campagne A')) $$,
  'Lancement accepté avec des crédits');

select is((select count(*)::int from public.lm_campaign_zones where campaign_id = (select id from public.lm_campaigns where name = 'Campagne A')),
  2, 'Les zones sont figées au lancement');

-- B ne voit rien de la campagne de A et ne peut pas la piloter
select makerkit.authenticate_as('disc_b');
select is((select count(*)::int from public.lm_campaign_zones), 0, 'B ne voit pas les zones de A');
select is((select count(*)::int from public.lm_campaign_categories), 0, 'B ne voit pas le rendement de A');
select throws_ok($$ select public.lm_pause_campaign((select id from public.lm_campaigns limit 1)) $$,
  'P0002', null, 'B ne peut pas mettre en pause une campagne qu''il ne voit pas');
select throws_ok($$ select public.lm_schedule_discovery() $$, '42501', null, 'Un utilisateur ne peut pas planifier');
select throws_ok($$ select public.lm_record_prospect(gen_random_uuid(), '{}') $$, '42501', null,
  'Un utilisateur ne peut pas enregistrer de prospect');

-- Planification par le service
set local role service_role;
select is(public.lm_schedule_discovery(), 2, 'Deux recherches planifiées (2 par campagne)');
select is(public.lm_schedule_discovery(), 0, 'Pas de nouvelle recherche tant que les deux sont en file');

select is(
  (select count(distinct payload ->> 'gcid')::int from public.lm_tasks where kind = 'discovery'
     and payload ->> 'campaign_id' = (select id from public.lm_campaigns where name = 'Campagne A')::text),
  2, 'Les deux catégories jamais essayées passent en premier');

-- Enregistrement d'un prospect : crédit débité une fois, doublon de site refusé
select is(public.lm_record_prospect((select id from public.lm_campaigns where name = 'Campagne A'),
  '{"place_id":"p1","name":"Boulangerie Dupont","site_key":"dupont.fr","website":"https://dupont.fr"}'), 'kept', 'Prospect retenu');
select is(public.lm_record_prospect((select id from public.lm_campaigns where name = 'Campagne A'),
  '{"place_id":"p2","name":"Dupont bis","site_key":"dupont.fr","website":"https://www.dupont.fr/x"}'), 'duplicate', 'Même site : doublon');
select is((select discovery_balance from public.lm_account_credits where account_id = (select id from public.accounts where slug = 'disc-a')),
  14999, 'Un seul crédit débité');

-- Fiche déjà vue : pas rouverte
select is(public.lm_mark_place_seen((select id from public.lm_spaces where name = 'Espace A'), 'p9', 'x.fr'), true, 'Première vue');
select is(public.lm_mark_place_seen((select id from public.lm_spaces where name = 'Espace A'), 'p9', 'x.fr'), false, 'Deuxième vue : déjà connue');

-- Fin de recherche : rendement mis à jour
select lives_ok($$ select public.lm_finish_search((select id from public.lm_campaigns where name = 'Campagne A'),
  'gcid:test_bakery', 0, 12, 10, 1, 5000) $$, 'Fin de recherche enregistrée');
select is((select (searches, kept, in_flight)::text from public.lm_campaign_categories where gcid = 'gcid:test_bakery'),
  '(1,1,0)', 'Rendement et place libérée');

-- Pause puis reprise : les recherches en attente sont annulées puis remises en file
select public.lm_pause_campaign((select id from public.lm_campaigns where name = 'Campagne A'));
select is((select count(*)::int from public.lm_tasks where kind = 'discovery' and status = 'queued'
  and payload ->> 'campaign_id' = (select id from public.lm_campaigns where name = 'Campagne A')::text), 0, 'Pause : plus rien en file');

set local role postgres;
select makerkit.authenticate_as('disc_a');
select public.lm_start_campaign((select id from public.lm_campaigns where name = 'Campagne A'));
set local role service_role;
select ok((select count(*) from public.lm_tasks where kind = 'discovery' and status = 'queued'
  and payload ->> 'campaign_id' = (select id from public.lm_campaigns where name = 'Campagne A')::text) >= 1, 'Reprise : recherches remises en file');

-- Crédits épuisés : la campagne se met en pause
update public.lm_account_credits set discovery_balance = 0 where account_id = (select id from public.accounts where slug = 'disc-a');
select is(public.lm_record_prospect((select id from public.lm_campaigns where name = 'Campagne A'),
  '{"place_id":"p3","name":"Salon Martin","site_key":"martin.fr"}'), 'no_credits', 'Plus de crédits');
select is((select status::text from public.lm_campaigns where name = 'Campagne A'), 'paused', 'Campagne mise en pause');
select is((select count(*)::int from public.lm_prospects where site_key = 'martin.fr'), 0, 'Prospect non conservé sans crédit');

-- Import CSV : sans crédit, dédoublonné
set local role postgres;
select makerkit.authenticate_as('disc_a');
select is((select (r.inserted, r.duplicates)::text from public.lm_import_prospects((select id from public.lm_spaces where name = 'Espace A'),
  '[{"name":"Import 1","site_key":"import1.fr"},{"name":"Import 1 bis","site_key":"import1.fr"},{"name":"Dupont","site_key":"dupont.fr"}]') r),
  '(1,2)'::text, 'Import : un ajouté, deux doublons');
select makerkit.authenticate_as('disc_b');
select throws_ok($$ select public.lm_import_prospects((select id from public.lm_spaces where name = 'Espace A'), '[]') $$,
  'P0002', null, 'B ne peut pas importer dans un espace de A');

select * from finish();

rollback;
