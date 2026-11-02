-- Roadmap n°14 : budget de proxy par client (invisible), la recherche ralentit au-delà.
begin;

select no_plan();

select tests.create_supabase_user('pb_a', 'pb_a@test.com');

set local role service_role;
select public.create_team_account('PB A', tests.get_supabase_uid('pb_a'), 'pb-a');
set local role postgres;

insert into public.lm_plans (id, name, seats, spaces, discovery_credits, outreach_credits, active_campaigns, auto_validation)
values ('growth', 'Growth', 2, 3, 30000, 15000, 1, false) on conflict (id) do nothing;
update public.lm_plans set proxy_gb_month = 50, active_campaigns = 5 where id = 'growth';
insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
insert into public.lm_country_coverage (country_code, name) values ('ZZ', 'Testland') on conflict do nothing;
insert into public.lm_geo_cities (geoname_id, name, ascii_name, country_code, population, latitude, longitude) values
  (990000201, 'Budgetville', 'Budgetville', 'ZZ', 500000, 12.0, 12.0)
on conflict do nothing;
insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded) values
  ('gcid:pb_a', 'PB alpha', 'PB alpha', 'Test', false, false),
  ('gcid:pb_b', 'PB bravo', 'PB bravo', 'Test', false, false)
on conflict do nothing;

update public.lm_campaigns set status = 'paused' where status = 'running';
update public.lm_discovery_settings set tasks_per_campaign = 3, explore_share = 0.25, over_budget_tasks_per_account = 1 where id;

select makerkit.authenticate_as('pb_a');
update public.lm_spaces set name = 'Espace PB' where is_default and account_id = (select id from public.accounts where slug = 'pb-a');

-- Deux campagnes, avec une estimation « terminée » pour chacune (tarif obligatoire au lancement, n°13)
insert into public.lm_campaigns (account_id, space_id, name, country_code, targeting, filters)
select (select id from public.accounts where slug = 'pb-a'), (select id from public.lm_spaces where name = 'Espace PB'),
       n, 'ZZ',
       '{"cities":{"mode":"list","geoname_ids":[990000201]},"categories":{"mode":"list","gcids":["gcid:pb_a","gcid:pb_b"]}}',
       '{"rating_min":1}'
  from (values ('Campagne PB 1'), ('Campagne PB 2')) v(n);

set local role postgres;
insert into public.lm_estimates (account_id, country_code, targeting, filters, mode, status, total_searches, sample_searches,
                                 done_searches, cards, matching, rate, credits_per_prospect, finished_at)
select account_id, 'ZZ', targeting, filters, 'exact', 'done', 2, 2, 2, 100, 20, 0.2, 1, now()
  from public.lm_campaigns where name = 'Campagne PB 1';

set local role service_role;
select public.lm_reset_credits((select id from public.accounts where slug = 'pb-a'), 'growth', now() + interval '1 month', 'pb:renewal:a');
set local role postgres;
select makerkit.authenticate_as('pb_a');
select public.lm_start_campaign((select id from public.lm_campaigns where name = 'Campagne PB 1'));
select public.lm_start_campaign((select id from public.lm_campaigns where name = 'Campagne PB 2'));
set local role postgres;

create temp table t_pb as select id as account_id from public.accounts where slug = 'pb-a';
grant select on t_pb to service_role;

-- les lancements ont déjà planifié des recherches : on repart de zéro pour contrôler le planificateur
delete from public.lm_tasks where kind = 'discovery' and account_id = (select account_id from t_pb);
update public.lm_campaign_categories set in_flight = 0 where account_id = (select account_id from t_pb);

-- 1. Sous le budget : 3 recherches par campagne
set local role service_role;
select is(public.lm_proxy_over_budget((select account_id from t_pb)), false, 'Compte neuf : budget non dépassé');
select public.lm_schedule_discovery();
set local role postgres;
select is((select count(*) from public.lm_tasks where kind = 'discovery' and status = 'queued' and account_id = (select account_id from t_pb)),
  6::bigint, 'Sous le budget : 3 recherches par campagne, 6 pour le compte');

-- 2. Le trafic des recherches et des estimations s'ajoute au compteur du compte
set local role service_role;
select public.lm_add_search_bytes((select min(id) from public.lm_tasks where kind = 'discovery' and account_id = (select account_id from t_pb)), 3000000);
set local role postgres;
insert into public.lm_tasks (account_id, kind, payload, idempotency_key, status)
values ((select account_id from t_pb), 'estimate', '{}', 'pb:test:estimate', 'done');
set local role service_role;
select public.lm_add_search_bytes((select id from public.lm_tasks where idempotency_key = 'pb:test:estimate'), 2000000);
set local role postgres;
select is((select proxy_bytes_period from public.lm_account_credits where account_id = (select account_id from t_pb)),
  5000000::bigint, 'Recherche (3 Mo) + estimation (2 Mo) comptées pour le compte');

-- 3. Budget dépassé : une seule recherche à la fois pour tout le compte
update public.lm_account_credits set proxy_bytes_period = 50::bigint * 1000000000
 where account_id = (select account_id from t_pb);
delete from public.lm_tasks where kind = 'discovery' and account_id = (select account_id from t_pb);
update public.lm_campaign_categories set in_flight = 0 where account_id = (select account_id from t_pb);

set local role service_role;
select is(public.lm_proxy_over_budget((select account_id from t_pb)), true, '50 Go consommés sur 50 : budget dépassé');
select public.lm_schedule_discovery();
set local role postgres;
select is((select count(*) from public.lm_tasks where kind = 'discovery' and status = 'queued' and account_id = (select account_id from t_pb)),
  1::bigint, 'Budget dépassé : 1 recherche à la fois pour tout le compte (2 campagnes en cours)');

-- le planificateur n'en ajoute pas tant que celle-là n'est pas finie
set local role service_role;
select public.lm_schedule_discovery();
set local role postgres;
select is((select count(*) from public.lm_tasks where kind = 'discovery' and status = 'queued' and account_id = (select account_id from t_pb)),
  1::bigint, 'Toujours 1 recherche en file au passage suivant');

-- 4. Sans plafond sur le forfait : pas de ralentissement
update public.lm_plans set proxy_gb_month = null where id = 'growth';
set local role service_role;
select is(public.lm_proxy_over_budget((select account_id from t_pb)), false, 'Forfait sans plafond : jamais dépassé');
set local role postgres;
update public.lm_plans set proxy_gb_month = 50 where id = 'growth';

-- 5. La recharge remet le compteur à zéro
set local role service_role;
select public.lm_reset_credits((select account_id from t_pb), 'growth', now() + interval '2 month', 'pb:renewal:b');
select is(public.lm_proxy_over_budget((select account_id from t_pb)), false, 'Après recharge : compteur à zéro, budget disponible');
set local role postgres;
select is((select proxy_bytes_period from public.lm_account_credits where account_id = (select account_id from t_pb)),
  0::bigint, 'proxy_bytes_period remis à zéro par la recharge');

select * from finish();

rollback;
