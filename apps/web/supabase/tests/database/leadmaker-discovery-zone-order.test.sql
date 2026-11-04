-- 4/11/2026 : « review cleaner » a passé 99 % de sa nuit dans Bruxelles (0,44 prospect par recherche, 4 à 5
-- dans les autres villes) : chaque activité faisait les 37 secteurs de Bruxelles avant la moindre autre ville.
-- Désormais, comme l'ancien bot : chaque ville par son nom d'abord, puis les secteurs en alternant les villes.
begin;

select no_plan();

select tests.create_supabase_user('zo_a', 'zo_a@test.com');

set local role service_role;
select public.create_team_account('Zo A', tests.get_supabase_uid('zo_a'), 'zo-a');
set local role postgres;

insert into public.lm_plans (id, name, seats, spaces, discovery_credits, outreach_credits, active_campaigns, auto_validation)
values ('growth', 'Growth', 2, 3, 30000, 15000, 1, false) on conflict (id) do nothing;
insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
insert into public.lm_country_coverage (country_code, name) values ('ZZ', 'Testland') on conflict do nothing;
insert into public.lm_geo_cities (geoname_id, name, ascii_name, country_code, population, latitude, longitude) values
  (990000501, 'Bigville', 'Bigville', 'ZZ', 200000, 30.0, 30.0),
  (990000502, 'Midville', 'Midville', 'ZZ', 80000, 31.0, 31.0),
  (990000503, 'Smallville', 'Smallville', 'ZZ', 10000, 32.0, 32.0),
  (990000504, 'Laterville', 'Laterville', 'ZZ', 20000, 33.0, 33.0)
on conflict do nothing;
insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded) values
  ('gcid:zo_one', 'Zo one', 'Zo un', 'Test', false, false)
on conflict do nothing;

update public.lm_campaigns set status = 'paused' where status = 'running';
update public.lm_discovery_settings set tasks_per_campaign = 3 where id;

select makerkit.authenticate_as('zo_a');
update public.lm_spaces set name = 'Espace Zo' where is_default and account_id = (select id from public.accounts where slug = 'zo-a');

insert into public.lm_campaigns (id, account_id, space_id, name, country_code, targeting, filters)
values ('a0000000-0000-4000-8000-0000000d0001', (select id from public.accounts where slug = 'zo-a'),
        (select id from public.lm_spaces where name = 'Espace Zo'), 'Campagne Zo', 'ZZ',
        '{"cities":{"mode":"list","geoname_ids":[990000501,990000502,990000503]},"categories":{"mode":"list","gcids":["gcid:zo_one"]}}',
        '{"rating_min":1}');

set local role service_role;
select public.lm_reset_credits((select id from public.accounts where slug = 'zo-a'), 'growth', now() + interval '1 month', 'zo:renewal:a');
set local role postgres;
insert into public.lm_estimates (account_id, country_code, targeting, filters, mode, status, total_searches, sample_searches,
                                 done_searches, cards, matching, rate, credits_per_prospect, finished_at)
select account_id, country_code, targeting, filters - 'paused_reason', 'exact', 'done', 1, 1, 1, 100, 50, 0.5, 1, now()
  from public.lm_campaigns where name = 'Campagne Zo';

select makerkit.authenticate_as('zo_a');
select public.lm_start_campaign('a0000000-0000-4000-8000-0000000d0001');
set local role postgres;

create temp view t_zones as
  select pos, idx, label, latitude is null as by_name
    from public.lm_campaign_zones where campaign_id = 'a0000000-0000-4000-8000-0000000d0001';

-- Les trois villes par leur nom, des plus peuplées aux moins peuplées, avant le moindre secteur
select results_eq(
  'select label, by_name from t_zones where pos < 3 order by pos',
  $$ values ('Bigville, Testland', true), ('Midville, Testland', true), ('Smallville, Testland', true) $$,
  'D''abord chaque ville par son nom, des plus peuplées aux moins peuplées');
select ok((select bool_and(not by_name) from t_zones where pos >= 3), 'Puis seulement les secteurs');

-- Secteurs en alternant les villes : le secteur 1 de chaque grande ville avant le secteur 2 de la première
select results_eq(
  'select label from t_zones where pos between 3 and 6 order by pos',
  $$ values ('Bigville, Testland · 1'), ('Midville, Testland · 1'), ('Bigville, Testland · 2'), ('Midville, Testland · 2') $$,
  'Les secteurs alternent entre les grandes villes');
select is((select count(*)::int from t_zones), (select count(distinct pos)::int from t_zones), 'Une position par zone');
select is((select max(pos) + 1 from t_zones), (select count(*)::int from t_zones), 'Positions continues depuis 0');

-- Le planificateur suit l'ordre de passage : la première recherche est « Zo one in Bigville, Testland »
set local role service_role;
select is(public.lm_schedule_discovery(), 3, 'Trois recherches planifiées');
set local role postgres;

select results_eq(
  $$ select payload ->> 'query', (payload ->> 'latitude') is null from public.lm_tasks
      where kind = 'discovery' and payload ->> 'campaign_id' = 'a0000000-0000-4000-8000-0000000d0001'
      order by (payload ->> 'zone_idx')::int $$,
  $$ values ('Zo one in Bigville, Testland', true), ('Zo one in Midville, Testland', true),
            ('Zo one in Smallville, Testland', true) $$,
  'Les trois premières recherches : chaque ville par son nom');

-- Une zone déjà cherchée (tâche existante) est sautée sans être recomptée : c'est ce qui permet de
-- renuméroter les campagnes en cours sans refaire leurs recherches
update public.lm_tasks set status = 'done', finished_at = now()
 where kind = 'discovery' and payload ->> 'campaign_id' = 'a0000000-0000-4000-8000-0000000d0001';
update public.lm_campaign_categories set in_flight = 0, searches = 3, kept = 3, next_zone_idx = 0
 where campaign_id = 'a0000000-0000-4000-8000-0000000d0001';

set local role service_role;
select is(public.lm_schedule_discovery(), 3, 'Trois nouvelles recherches');
set local role postgres;

select is((select count(*)::int from public.lm_tasks
            where kind = 'discovery' and payload ->> 'campaign_id' = 'a0000000-0000-4000-8000-0000000d0001'), 6,
  'Les villes déjà cherchées ne sont pas replanifiées');
select results_eq(
  $$ select payload ->> 'zone' from public.lm_tasks
      where kind = 'discovery' and status = 'queued' and payload ->> 'campaign_id' = 'a0000000-0000-4000-8000-0000000d0001'
      order by (payload ->> 'zone_idx')::int $$,
  $$ values ('Bigville, Testland · 1'), ('Midville, Testland · 1'), ('Bigville, Testland · 2') $$,
  'Le planificateur passe aux zones suivantes');
select is((select next_zone_idx from public.lm_campaign_categories where campaign_id = 'a0000000-0000-4000-8000-0000000d0001'),
  6, 'Le curseur a sauté les trois zones faites');

-- Ville ajoutée au ciblage en cours de campagne : en fin de file, avec une position à la suite
select makerkit.authenticate_as('zo_a');
select is(public.lm_update_campaign('a0000000-0000-4000-8000-0000000d0001', 'Campagne Zo', 'ZZ',
  '{"cities":{"mode":"list","geoname_ids":[990000501,990000502,990000503,990000504]},"categories":{"mode":"list","gcids":["gcid:zo_one"]}}',
  '{"rating_min":1}'), 'running', 'Ciblage élargi');
set local role postgres;

select results_eq(
  'select label, by_name from t_zones where pos = (select max(pos) from t_zones)',
  $$ values ('Laterville, Testland', true) $$,
  'La ville ajoutée passe en fin de file');
select is((select max(pos) + 1 from t_zones), (select count(*)::int from t_zones), 'Positions toujours continues');

select * from finish();

rollback;
