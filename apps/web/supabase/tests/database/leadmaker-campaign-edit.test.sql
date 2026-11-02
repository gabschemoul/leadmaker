-- Modification d'une campagne après le lancement : villes et activités ajoutées / retirées.
begin;

select no_plan();

select tests.create_supabase_user('edit_a', 'edit_a@test.com');
select tests.create_supabase_user('edit_b', 'edit_b@test.com');

set local role service_role;
select public.create_team_account('Edit A', tests.get_supabase_uid('edit_a'), 'edit-a');
select public.create_team_account('Edit B', tests.get_supabase_uid('edit_b'), 'edit-b');
set local role postgres;

insert into public.lm_plans (id, name, seats, spaces, discovery_credits, outreach_credits, daily_send_limit, active_campaigns, auto_validation)
values ('growth', 'Growth', 2, 3, 15000, 5000, 500, 1, false) on conflict (id) do nothing;
insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
insert into public.lm_country_coverage (country_code, name) values ('ZZ', 'Testland') on conflict do nothing;
insert into public.lm_geo_cities (geoname_id, name, ascii_name, country_code, population, latitude, longitude) values
  (990000002, 'Smallville', 'Smallville', 'ZZ', 2000, 10.05, 10.05),
  (990000004, 'Tinyville', 'Tinyville', 'ZZ', 1500, 12.0, 12.0),
  (990000005, 'Microville', 'Microville', 'ZZ', 800, 13.0, 13.0)
on conflict do nothing;
insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded) values
  ('gcid:test_bakery', 'Test bakery', 'Boulangerie test', 'Commerces', true, false),
  ('gcid:test_salon', 'Test salon', 'Salon test', 'Beauté', true, false)
on conflict do nothing;

update public.lm_campaigns set status = 'paused' where status = 'running';

set local role service_role;
select public.lm_reset_credits((select id from public.accounts where slug = 'edit-a'), 'growth', now() + interval '1 month', 'edit:renewal:a');
set local role postgres;

select makerkit.authenticate_as('edit_a');

insert into public.lm_campaigns (id, account_id, space_id, name, country_code, targeting, filters)
values ('a0000000-0000-4000-8000-00000000e001',
        (select id from public.accounts where slug = 'edit-a'),
        (select id from public.lm_spaces where account_id = (select id from public.accounts where slug = 'edit-a') and is_default),
        'Campagne E', 'ZZ',
        '{"cities":{"mode":"list","geoname_ids":[990000002]},"categories":{"mode":"list","gcids":["gcid:test_bakery"]}}',
        '{"rating_min":0.8,"rating_max":3.5,"website":"with"}');

-- Avant le lancement : tout se modifie, pays compris
select is(public.lm_update_campaign('a0000000-0000-4000-8000-00000000e001', 'Campagne E2', 'zz',
  '{"cities":{"mode":"list","geoname_ids":[990000002]},"categories":{"mode":"list","gcids":["gcid:test_bakery"]}}',
  '{"rating_min":1,"rating_max":4,"website":"all"}'), 'draft', 'Brouillon : mise à jour acceptée');
select is((select (name, country_code, filters ->> 'website')::text from public.lm_campaigns where id = 'a0000000-0000-4000-8000-00000000e001'),
  '("Campagne E2",ZZ,all)', 'Nom, pays et filtres enregistrés');
select is((select count(*)::int from public.lm_campaign_zones where campaign_id = 'a0000000-0000-4000-8000-00000000e001'),
  0, 'Pas de zone avant le lancement');

-- Lancement : 1 ville, 1 activité
set local role postgres;
-- Roadmap n°13 : le premier lancement exige une estimation terminée avec le même ciblage et les mêmes filtres
insert into public.lm_estimates (account_id, country_code, targeting, filters, mode, status, total_searches, sample_searches,
                                 done_searches, cards, matching, rate, credits_per_prospect, finished_at)
select account_id, country_code, targeting, filters - 'paused_reason', 'exact', 'done', 1, 1, 1, 100, 50, 0.5, 1, now()
  from public.lm_campaigns where id = 'a0000000-0000-4000-8000-00000000e001';
select makerkit.authenticate_as('edit_a');
select public.lm_start_campaign('a0000000-0000-4000-8000-00000000e001');
select is((select count(*)::int from public.lm_campaign_zones where campaign_id = 'a0000000-0000-4000-8000-00000000e001'), 1, 'Une zone au lancement');

-- Après le lancement : le pays est verrouillé
select throws_ok($$ select public.lm_update_campaign('a0000000-0000-4000-8000-00000000e001', 'Campagne E2', 'FR',
  '{"cities":{"mode":"list","geoname_ids":[990000002]},"categories":{"mode":"list","gcids":["gcid:test_bakery"]}}', '{}') $$,
  'P0001', 'country cannot change after launch', 'Le pays ne change plus après le lancement');

-- Ajout d'une ville et d'une activité : ajoutées à la fin de la file, campagne toujours en cours
select is(public.lm_update_campaign('a0000000-0000-4000-8000-00000000e001', 'Campagne E2', 'ZZ',
  '{"cities":{"mode":"list","geoname_ids":[990000002,990000004]},"categories":{"mode":"list","gcids":["gcid:test_bakery","gcid:test_salon"]}}',
  '{"rating_min":1,"rating_max":4,"website":"all"}'), 'running', 'Campagne en cours : reste en cours');
select is((select (idx, removed)::text from public.lm_campaign_zones where campaign_id = 'a0000000-0000-4000-8000-00000000e001' and geoname_id = 990000004),
  '(1,f)', 'La nouvelle ville prend la place suivante');
select is((select (removed, next_zone_idx)::text from public.lm_campaign_categories where campaign_id = 'a0000000-0000-4000-8000-00000000e001' and gcid = 'gcid:test_salon'),
  '(f,0)', 'La nouvelle activité commence par la première ville');
select is((select (zones, categories, searches_total)::text from public.lm_campaign_progress('a0000000-0000-4000-8000-00000000e001')),
  '(2,2,4)', 'Avancement : 2 villes × 2 activités');

-- Retrait de la première ville : sautée, pas supprimée
select public.lm_update_campaign('a0000000-0000-4000-8000-00000000e001', 'Campagne E2', 'ZZ',
  '{"cities":{"mode":"list","geoname_ids":[990000004]},"categories":{"mode":"list","gcids":["gcid:test_bakery","gcid:test_salon"]}}',
  '{"rating_min":1,"rating_max":4,"website":"all"}');
select is((select (idx, removed)::text from public.lm_campaign_zones where campaign_id = 'a0000000-0000-4000-8000-00000000e001' and geoname_id = 990000002),
  '(0,t)', 'La ville retirée est marquée, sa place est conservée');
select is((select zones from public.lm_campaign_progress('a0000000-0000-4000-8000-00000000e001')), 1, 'Avancement : la ville retirée ne compte plus');

-- Planification : la ville retirée est sautée, les deux activités cherchent dans la nouvelle ville
set local role service_role;
select is(public.lm_schedule_discovery(), 2, 'Deux recherches planifiées');
select is((select count(*)::int from public.lm_tasks where kind = 'discovery' and payload ->> 'campaign_id' = 'a0000000-0000-4000-8000-00000000e001'
  and (payload ->> 'zone_idx')::int = 0), 0, 'Aucune recherche dans la ville retirée');
select is((select count(*)::int from public.lm_tasks where kind = 'discovery' and payload ->> 'campaign_id' = 'a0000000-0000-4000-8000-00000000e001'
  and (payload ->> 'zone_idx')::int = 1), 2, 'Les deux activités cherchent dans la nouvelle ville');

-- Les deux recherches finissent (le robot clôt ses tâches) : plus rien à faire, campagne terminée
update public.lm_tasks set status = 'done', finished_at = now()
 where kind = 'discovery' and payload ->> 'campaign_id' = 'a0000000-0000-4000-8000-00000000e001';
select public.lm_finish_search('a0000000-0000-4000-8000-00000000e001', 'gcid:test_bakery', 1, 5, 5, 2, 1000);
select public.lm_finish_search('a0000000-0000-4000-8000-00000000e001', 'gcid:test_salon', 1, 5, 5, 2, 1000);
select public.lm_schedule_discovery();
select is((select status::text from public.lm_campaigns where id = 'a0000000-0000-4000-8000-00000000e001'), 'completed', 'Campagne terminée');

-- Campagne terminée + nouvelle ville : repasse en pause, puis « Reprendre » la relance
set local role postgres;
select makerkit.authenticate_as('edit_a');
select is(public.lm_update_campaign('a0000000-0000-4000-8000-00000000e001', 'Campagne E2', 'ZZ',
  '{"cities":{"mode":"list","geoname_ids":[990000004,990000005]},"categories":{"mode":"list","gcids":["gcid:test_bakery","gcid:test_salon"]}}',
  '{"rating_min":1,"rating_max":4,"website":"all"}'), 'paused', 'Terminée + nouvelle ville : en pause');
select lives_ok($$ select public.lm_start_campaign('a0000000-0000-4000-8000-00000000e001') $$, 'Reprise acceptée');
set local role service_role;
select is(public.lm_schedule_discovery(), 2, 'Les recherches reprennent dans la nouvelle ville');
set local role postgres;
select makerkit.authenticate_as('edit_a');

-- La raison de pause est conservée
select public.lm_pause_campaign('a0000000-0000-4000-8000-00000000e001', 'no_credits');
select public.lm_update_campaign('a0000000-0000-4000-8000-00000000e001', 'Campagne E2', 'ZZ',
  '{"cities":{"mode":"list","geoname_ids":[990000004,990000005]},"categories":{"mode":"list","gcids":["gcid:test_bakery"]}}',
  '{"rating_min":1,"rating_max":4,"website":"all"}');
select is((select filters ->> 'paused_reason' from public.lm_campaigns where id = 'a0000000-0000-4000-8000-00000000e001'), 'no_credits',
  'La raison de pause survit à la modification');
select is((select removed from public.lm_campaign_categories where campaign_id = 'a0000000-0000-4000-8000-00000000e001' and gcid = 'gcid:test_salon'),
  true, 'L''activité retirée est marquée');

-- Duplication : copie en brouillon avec ciblage, filtres, messages et réglages d'envoi
update public.lm_campaigns set templates = '{"messages":[{"subject":"Bonjour","body":"Test {company}"}]}', daily_limit = 42
 where id = 'a0000000-0000-4000-8000-00000000e001';
select lives_ok($$ select public.lm_duplicate_campaign('a0000000-0000-4000-8000-00000000e001', 'Campagne E2 (copie)') $$, 'Duplication acceptée');
select is((select (c.status::text, c.country_code, c.daily_limit, c.templates ->> 'messages' is not null, c.targeting = s.targeting, c.filters ? 'paused_reason')::text
             from public.lm_campaigns c, (select targeting from public.lm_campaigns where id = 'a0000000-0000-4000-8000-00000000e001') s
            where c.name = 'Campagne E2 (copie)'),
  '(draft,ZZ,42,t,t,f)', 'Copie en brouillon, même ciblage, raison de pause non copiée');
select is((select count(*)::int from public.lm_campaign_zones z join public.lm_campaigns c on c.id = z.campaign_id where c.name = 'Campagne E2 (copie)'),
  0, 'La copie n''a pas de zone (pas encore lancée)');

-- Isolation : B ne peut pas modifier la campagne de A
select makerkit.authenticate_as('edit_b');
select throws_ok($$ select public.lm_update_campaign('a0000000-0000-4000-8000-00000000e001', 'Piratée', 'ZZ', '{}', '{}') $$,
  'P0002', null, 'B ne peut pas modifier la campagne de A');
select is((select name from public.lm_campaigns where id = 'a0000000-0000-4000-8000-00000000e001'), null, 'B ne voit pas la campagne de A');
select throws_ok($$ select public.lm_duplicate_campaign('a0000000-0000-4000-8000-00000000e001', 'Volée') $$,
  'P0002', null, 'B ne peut pas dupliquer la campagne de A');

select * from finish();

rollback;
