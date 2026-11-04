-- 4/11/2026 : une campagne US de Nath restait bloquée sur « On mesure d'abord la difficulté » (8/30 après
-- 10 min, proxy indisponible). Plus aucune attente : « Lancer » démarre la campagne tout de suite à 1 crédit
-- par prospect, la mesure tourne en parallèle et fixe le tarif quand elle se termine.
begin;

select no_plan();

select tests.create_supabase_user('lw_a', 'lw_a@test.com');

set local role service_role;
select public.create_team_account('Lw A', tests.get_supabase_uid('lw_a'), 'lw-a');
set local role postgres;

insert into public.lm_plans (id, name, seats, spaces, discovery_credits, outreach_credits, active_campaigns, auto_validation)
values ('lw_plan', 'Lw', 2, 3, 30000, 15000, 5, false) on conflict (id) do nothing;
insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
update public.lm_discovery_settings
   set credit_tiers = '[{"min_rate": 0.10, "credits": 1}, {"min_rate": 0.03, "credits": 2}, {"min_rate": 0.01, "credits": 3}, {"min_rate": 0, "credits": 4}]'
 where id;
insert into public.lm_country_coverage (country_code, name) values ('ZY', 'Waitland') on conflict do nothing;
insert into public.lm_geo_cities (geoname_id, name, ascii_name, country_code, population, latitude, longitude) values
  (990000601, 'Alphaton', 'Alphaton', 'ZY', 20000, 40.0, 40.0),
  (990000602, 'Betaton', 'Betaton', 'ZY', 10000, 41.0, 41.0)
on conflict do nothing;
insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded) values
  ('gcid:lw_one', 'Lw one', 'Lw un', 'Test', false, false),
  ('gcid:lw_two', 'Lw two', 'Lw deux', 'Test', false, false)
on conflict do nothing;

set local role service_role;
select public.lm_reset_credits((select id from public.accounts where slug = 'lw-a'), 'lw_plan', now() + interval '1 month', 'lw:renewal:a');
set local role postgres;

create temp table t_lw as
  select (select id from public.accounts where slug = 'lw-a') as acc,
         (select s.id from public.lm_spaces s join public.accounts a on a.id = s.account_id
           where a.slug = 'lw-a' and s.is_default) as space;
grant select on t_lw to authenticated, service_role;

insert into public.lm_campaigns (id, account_id, space_id, name, country_code, targeting, filters)
select 'a0000000-0000-4000-8000-0000000e0001', acc, space, 'Sans attente', 'ZY',
       '{"cities":{"mode":"list","geoname_ids":[990000601,990000602]},"categories":{"mode":"list","gcids":["gcid:lw_one"]}}',
       '{"rating_min":1}'
  from t_lw;

-- 1. Aucune estimation : « Lancer » démarre tout de suite
select makerkit.authenticate_as('lw_a');
select lives_ok($$ select public.lm_start_campaign('a0000000-0000-4000-8000-0000000e0001') $$,
  'Lancer sans estimation ne bloque plus');
set local role postgres;

select is((select status::text from public.lm_campaigns where id = 'a0000000-0000-4000-8000-0000000e0001'), 'running',
  'La campagne tourne immédiatement');
select is((select (credits_per_prospect, price_pending)::text from public.lm_campaigns
            where id = 'a0000000-0000-4000-8000-0000000e0001'), '(1,t)',
  '1 crédit par prospect en attendant la mesure');
select is((select e.status from public.lm_estimates e join public.lm_campaigns c on c.estimate_id = e.id
            where c.id = 'a0000000-0000-4000-8000-0000000e0001'), 'running',
  'La mesure de difficulté tourne en parallèle');
select is((select count(*)::int from public.lm_tasks t join public.lm_campaigns c
             on t.payload ->> 'estimate_id' = c.estimate_id::text
            where c.id = 'a0000000-0000-4000-8000-0000000e0001' and t.kind = 'estimate' and t.status = 'queued'), 2,
  'Ses recherches de mesure sont en file');

-- L'écran montre la mesure en cours, campagne lancée
select makerkit.authenticate_as('lw_a');
select is((select (frozen, credits_per_prospect, estimate_status, done_searches, sample_searches)::text
             from public.lm_campaign_pricing('a0000000-0000-4000-8000-0000000e0001')),
  '(t,,running,0,2)', 'Tarif : mesure en cours sur une campagne déjà lancée');

-- 2. Une autre estimation demandée par l'organisation n'abandonne pas cette mesure
select lives_ok($$ select public.lm_request_estimate((select acc from t_lw), 'ZY',
  '{"cities":{"mode":"list","geoname_ids":[990000601]},"categories":{"mode":"list","gcids":["gcid:lw_two"]}}', '{}') $$,
  'Autre estimation demandée');
set local role postgres;

select is((select e.status from public.lm_estimates e join public.lm_campaigns c on c.estimate_id = e.id
            where c.id = 'a0000000-0000-4000-8000-0000000e0001'), 'running',
  'La mesure qui fixera le tarif d''une campagne lancée n''est pas abandonnée');
select is((select count(*)::int from public.lm_tasks t join public.lm_campaigns c
             on t.payload ->> 'estimate_id' = c.estimate_id::text
            where c.id = 'a0000000-0000-4000-8000-0000000e0001' and t.kind = 'estimate' and t.status = 'queued'), 2,
  'Ses recherches restent en file');

-- 3. La mesure se termine : 2 entreprises sur 200 passent (1 %) → 3 crédits par prospect, pour la suite
set local role service_role;
select public.lm_record_estimate_search(
  (select estimate_id from public.lm_campaigns where id = 'a0000000-0000-4000-8000-0000000e0001'), 100, array['lw:p1'], false);
select is((select price_pending from public.lm_campaigns where id = 'a0000000-0000-4000-8000-0000000e0001'), true,
  'Mesure pas finie : toujours 1 crédit');
select public.lm_record_estimate_search(
  (select estimate_id from public.lm_campaigns where id = 'a0000000-0000-4000-8000-0000000e0001'), 100, array['lw:p2'], false);
set local role postgres;

select is((select (credits_per_prospect, price_pending)::text from public.lm_campaigns
            where id = 'a0000000-0000-4000-8000-0000000e0001'), '(3,f)',
  'Mesure finie : le tarif mesuré est fixé');

select makerkit.authenticate_as('lw_a');
select is((select (frozen, credits_per_prospect, rate, estimate_status)::text
             from public.lm_campaign_pricing('a0000000-0000-4000-8000-0000000e0001')),
  '(t,3,0.0100,)', 'Tarif affiché : 3 crédits, figé');
set local role postgres;

-- 4. Une mesure déjà en cours avec le même ciblage est reprise, pas relancée
insert into public.lm_campaigns (id, account_id, space_id, name, country_code, targeting, filters)
select 'a0000000-0000-4000-8000-0000000e0002', acc, space, 'Mesure en cours', 'ZY',
       '{"cities":{"mode":"list","geoname_ids":[990000601]},"categories":{"mode":"list","gcids":["gcid:lw_two"]}}', '{}'
  from t_lw;

select makerkit.authenticate_as('lw_a');
select public.lm_start_campaign('a0000000-0000-4000-8000-0000000e0002');
set local role postgres;

select is((select estimate_id from public.lm_campaigns where id = 'a0000000-0000-4000-8000-0000000e0002'),
  (select id from public.lm_estimates where account_id = (select acc from t_lw)
      and targeting = '{"cities":{"mode":"list","geoname_ids":[990000601]},"categories":{"mode":"list","gcids":["gcid:lw_two"]}}'
      and status = 'running'),
  'La campagne reprend la mesure déjà en cours');
select is((select count(*)::int from public.lm_estimates where account_id = (select acc from t_lw)), 2,
  'Aucune mesure en double');

-- 5. Estimation déjà terminée : tarif fixé au lancement, comme avant
insert into public.lm_estimates (account_id, country_code, targeting, filters, mode, status, total_searches, sample_searches,
                                 done_searches, cards, matching, rate, credits_per_prospect, finished_at)
select acc, 'ZY', '{"cities":{"mode":"list","geoname_ids":[990000602]},"categories":{"mode":"list","gcids":["gcid:lw_two"]}}',
       '{}', 'exact', 'done', 1, 1, 1, 100, 5, 0.05, 2, now()
  from t_lw;
insert into public.lm_campaigns (id, account_id, space_id, name, country_code, targeting, filters)
select 'a0000000-0000-4000-8000-0000000e0003', acc, space, 'Déjà mesurée', 'ZY',
       '{"cities":{"mode":"list","geoname_ids":[990000602]},"categories":{"mode":"list","gcids":["gcid:lw_two"]}}', '{}'
  from t_lw;

select makerkit.authenticate_as('lw_a');
select public.lm_start_campaign('a0000000-0000-4000-8000-0000000e0003');
set local role postgres;

select is((select (status, credits_per_prospect, price_pending)::text from public.lm_campaigns
            where id = 'a0000000-0000-4000-8000-0000000e0003'), '(running,2,f)',
  'Estimation terminée : tarif mesuré dès le lancement');

-- 6. Un membre ne peut pas toucher au tarif en attente lui-même
select makerkit.authenticate_as('lw_a');
select throws_ok(
  $$ update public.lm_campaigns set price_pending = true where id = 'a0000000-0000-4000-8000-0000000e0003' $$,
  '42501', null, 'Le tarif en attente ne se modifie pas à la main');
set local role postgres;

select * from finish();

rollback;
