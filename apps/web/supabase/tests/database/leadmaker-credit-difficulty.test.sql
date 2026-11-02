-- Roadmap n°13 : crédits selon la difficulté (estimation) et classement des activités par prospects par Mo.
begin;

select no_plan();

select tests.create_supabase_user('cred_a', 'cred_a@test.com');
select tests.create_supabase_user('cred_b', 'cred_b@test.com');

set local role service_role;
select public.create_team_account('Cred A', tests.get_supabase_uid('cred_a'), 'cred-a');
select public.create_team_account('Cred B', tests.get_supabase_uid('cred_b'), 'cred-b');
set local role postgres;

insert into public.lm_plans (id, name, seats, spaces, discovery_credits, outreach_credits, daily_send_limit, active_campaigns, auto_validation)
values ('growth', 'Growth', 2, 3, 15000, 5000, 500, 1, false) on conflict (id) do nothing;
insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
insert into public.lm_country_coverage (country_code, name) values ('ZZ', 'Testland') on conflict do nothing;
insert into public.lm_geo_cities (geoname_id, name, ascii_name, country_code, population, latitude, longitude) values
  (990000101, 'Credtown', 'Credtown', 'ZZ', 20000, 11.0, 11.0)
on conflict do nothing;
insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded) values
  ('gcid:c_cheap', 'C cheap', 'C cheap', 'Test', false, false),
  ('gcid:c_pricey', 'C pricey', 'C pricey', 'Test', false, false)
on conflict do nothing;

update public.lm_campaigns set status = 'paused' where status = 'running';
update public.lm_discovery_settings
   set tasks_per_campaign = 2, explore_share = 0.25, abandon_zero_after = 5, min_searches = 40, min_rate = 0.05,
       prior = 5, default_search_mb = 4,
       credit_tiers = '[{"min_rate": 0.10, "credits": 1}, {"min_rate": 0.03, "credits": 2}, {"min_rate": 0.01, "credits": 3}, {"min_rate": 0, "credits": 4}]'
 where id;

-- 1. Paliers de crédits
select is(public.lm_credits_for_rate(0.25), 1, '25 % des fiches passent les filtres : 1 crédit par prospect');
select is(public.lm_credits_for_rate(0.10), 1, '10 % : 1 crédit (palier inclus)');
select is(public.lm_credits_for_rate(0.05), 2, '5 % : 2 crédits');
select is(public.lm_credits_for_rate(0.02), 3, '2 % : 3 crédits');
select is(public.lm_credits_for_rate(0.004), 4, '0,4 % : 4 crédits');
select is(public.lm_credits_for_rate(null), 1, 'Sans taux mesurable : 1 crédit');

-- 2. Campagne sans estimation : le lancement est refusé
select makerkit.authenticate_as('cred_a');

update public.lm_spaces set name = 'Espace Cred' where is_default and account_id = (select id from public.accounts where slug = 'cred-a');

insert into public.lm_campaigns (account_id, space_id, name, country_code, targeting, filters)
values ((select id from public.accounts where slug = 'cred-a'), (select id from public.lm_spaces where name = 'Espace Cred'),
        'Campagne Cred', 'ZZ',
        '{"cities":{"mode":"list","geoname_ids":[990000101]},"categories":{"mode":"list","gcids":["gcid:c_cheap","gcid:c_pricey"]}}',
        '{"rating_min":1,"rating_max":5,"min_reviews":0,"website":"with","exclude_public":true,"main_category_only":true,"extra_exclusions":[]}');

set local role service_role;
select public.lm_reset_credits((select id from public.accounts where slug = 'cred-a'), 'growth', now() + interval '1 month', 'cred:renewal:a');
set local role postgres;
select makerkit.authenticate_as('cred_a');

create temp table t_cred as
  select id as campaign_id, account_id from public.lm_campaigns where name = 'Campagne Cred';
grant select on t_cred to service_role, authenticated;

select throws_ok(
  $$ select public.lm_start_campaign((select campaign_id from t_cred)) $$,
  'P0001', 'estimate required before launch',
  'Sans estimation correspondante, la campagne ne se lance pas (hint estimate_required)');

select is((select frozen from public.lm_campaign_pricing((select campaign_id from t_cred))), false,
  'Avant lancement, le tarif n''est pas figé');
select is((select estimate_status from public.lm_campaign_pricing((select campaign_id from t_cred))), null,
  'Avant lancement et sans estimation : aucune estimation connue');

-- 3. L'estimation lancée depuis la campagne a exactement son ciblage et ses filtres
select lives_ok($$ select public.lm_request_campaign_estimate((select campaign_id from t_cred)) $$,
  'Un membre lance l''estimation de la campagne');

select is((select estimate_status from public.lm_campaign_pricing((select campaign_id from t_cred))), 'running',
  'Le tarif de la campagne suit l''estimation en cours');

-- Un autre compte ne peut pas lancer l'estimation de cette campagne
select makerkit.authenticate_as('cred_b');
select throws_ok($$ select public.lm_request_campaign_estimate((select campaign_id from t_cred)) $$, 'P0002', null,
  'Un membre d''une autre équipe ne lance pas l''estimation');
select makerkit.authenticate_as('cred_a');

-- 4. Le robot termine l'estimation : 2 recherches, 5 fiches qui passent sur 100 lues = 5 % → 2 crédits
set local role postgres;
create temp table t_est as
  select id as estimate_id, sample_searches from public.lm_estimates
   where account_id = (select account_id from t_cred) and status = 'running';
grant select on t_est to service_role, authenticated;

select is((select sample_searches from t_est), 2, 'Estimation exacte : 1 ville × 2 activités = 2 recherches');

set local role service_role;
select public.lm_record_estimate_search((select estimate_id from t_est), 50, array['p1', 'p2', 'p3'], false);
select public.lm_record_estimate_search((select estimate_id from t_est), 50, array['p4', 'p5'], false);
set local role postgres;

select is((select status from public.lm_estimates where id = (select estimate_id from t_est)), 'done', 'Estimation terminée');
select is((select rate from public.lm_estimates where id = (select estimate_id from t_est)), 0.0500, 'Taux mesuré : 5 %');
select is((select credits_per_prospect from public.lm_estimates where id = (select estimate_id from t_est)), 2,
  '5 % → 2 crédits par prospect');

select makerkit.authenticate_as('cred_a');
select is((select credits_per_prospect from public.lm_campaign_pricing((select campaign_id from t_cred))), 2,
  'Avant lancement, le tarif affiché est celui de l''estimation terminée');

-- 5. Lancement : le tarif est figé sur la campagne
select lives_ok($$ select public.lm_start_campaign((select campaign_id from t_cred)) $$, 'La campagne se lance avec son estimation');

select is((select credits_per_prospect from public.lm_campaigns where id = (select campaign_id from t_cred)), 2,
  'Tarif figé : 2 crédits par prospect');
select is((select estimate_id from public.lm_campaigns where id = (select campaign_id from t_cred)), (select estimate_id from t_est),
  'La campagne garde la trace de l''estimation utilisée');
select is((select frozen from public.lm_campaign_pricing((select campaign_id from t_cred))), true, 'Après lancement, tarif figé');

-- Une nouvelle estimation plus facile ne change plus le tarif de la campagne lancée
set local role postgres;
insert into public.lm_estimates (account_id, country_code, targeting, filters, mode, status, total_searches, sample_searches,
                                 done_searches, cards, matching, rate, credits_per_prospect, finished_at)
select account_id, 'ZZ', targeting, filters, 'exact', 'done', 2, 2, 2, 100, 50, 0.5, 1, now()
  from public.lm_campaigns where id = (select campaign_id from t_cred);
select makerkit.authenticate_as('cred_a');
select is((select credits_per_prospect from public.lm_campaign_pricing((select campaign_id from t_cred))), 2,
  'Le tarif figé ignore les estimations faites après le lancement');

-- 6. Chaque prospect débite 2 crédits
set local role service_role;
select is(public.lm_record_prospect((select campaign_id from t_cred),
  '{"place_id":"pl-1","name":"Entreprise 1","website":"https://entreprise-1.example","site_key":"entreprise-1.example"}'),
  'kept', 'Prospect gardé');
select is((select discovery_balance from public.lm_account_credits where account_id = (select account_id from t_cred)),
  15000 - 2, 'Un prospect = 2 crédits de prospection débités');
select is((select -delta from public.lm_credit_ledger where campaign_id = (select campaign_id from t_cred) and kind = 'discovery'
            order by created_at desc limit 1), 2, 'Le journal des crédits porte le débit de 2');

-- Plus assez de crédits pour un prospect à 2 : refus et pause
update public.lm_account_credits set discovery_balance = 1 where account_id = (select account_id from t_cred);
select is(public.lm_record_prospect((select campaign_id from t_cred),
  '{"place_id":"pl-2","name":"Entreprise 2","website":"https://entreprise-2.example","site_key":"entreprise-2.example"}'),
  'no_credits', 'Un seul crédit restant ne suffit pas pour un prospect à 2 crédits');
select is((select status from public.lm_campaigns where id = (select campaign_id from t_cred)), 'paused',
  'La campagne passe en pause faute de crédits');
update public.lm_account_credits set discovery_balance = 14998 where account_id = (select account_id from t_cred);

-- 7. Trafic par activité : lm_add_search_bytes
set local role postgres;
-- vide les recherches planifiées pour maîtriser l'historique
delete from public.lm_tasks where kind = 'discovery' and payload ->> 'campaign_id' = (select campaign_id from t_cred)::text;
update public.lm_campaign_categories set in_flight = 0, next_zone_idx = 0 where campaign_id = (select campaign_id from t_cred);

insert into public.lm_tasks (account_id, kind, payload, idempotency_key, status)
values ((select account_id from t_cred), 'discovery',
        jsonb_build_object('campaign_id', (select campaign_id from t_cred), 'gcid', 'gcid:c_pricey',
                           'zone', (select label from public.lm_campaign_zones where campaign_id = (select campaign_id from t_cred) order by idx limit 1)),
        'cred:test:bytes', 'done');

set local role service_role;
select public.lm_finish_search((select campaign_id from t_cred), 'gcid:c_pricey', 0, 120, 60, 10, 30000, null);
select public.lm_add_search_bytes((select id from public.lm_tasks where idempotency_key = 'cred:test:bytes'), 35000000);
select public.lm_add_search_bytes((select id from public.lm_tasks where idempotency_key = 'cred:test:bytes'), 0);
set local role postgres;

select is((select proxy_bytes from public.lm_campaign_categories where campaign_id = (select campaign_id from t_cred) and gcid = 'gcid:c_pricey'),
  35000000::bigint, 'Le trafic de la recherche est ajouté à l''activité (35 Mo)');
select is((select proxy_bytes from public.lm_searches where campaign_id = (select campaign_id from t_cred) and category = 'gcid:c_pricey'),
  35000000::bigint, 'Le journal de la recherche porte aussi son trafic');

-- 8. Planificateur : à prospects par recherche égaux, l'activité qui coûte moins de Mo passe d'abord
-- cheap : 10 recherches, 50 prospects, 20 Mo au total (2 Mo/recherche)  → 50 / (2 × (10+0+5))  = 1,67 prospect/Mo
-- pricey : 10 recherches, 50 prospects, 350 Mo au total (35 Mo/recherche) → 50 / (35 × 15)     = 0,10 prospect/Mo
update public.lm_campaign_categories set searches = 10, kept = 50, proxy_bytes = 20000000, in_flight = 0, next_zone_idx = 0, abandoned = false
 where campaign_id = (select campaign_id from t_cred) and gcid = 'gcid:c_cheap';
update public.lm_campaign_categories set searches = 10, kept = 50, proxy_bytes = 350000000, in_flight = 0, next_zone_idx = 0, abandoned = false
 where campaign_id = (select campaign_id from t_cred) and gcid = 'gcid:c_pricey';
update public.lm_campaigns set status = 'running' where id = (select campaign_id from t_cred);
update public.lm_discovery_settings set tasks_per_campaign = 1 where id;

set local role service_role;
select public.lm_schedule_discovery();
set local role postgres;

select is((select payload ->> 'gcid' from public.lm_tasks where kind = 'discovery' and status = 'queued'
            and payload ->> 'campaign_id' = (select campaign_id from t_cred)::text),
  'gcid:c_cheap', 'La place va à l''activité qui rapporte le plus de prospects par Mo, pas par recherche');

-- Sans mesure de trafic, le classement retombe sur les prospects par recherche
delete from public.lm_tasks where kind = 'discovery' and status = 'queued' and payload ->> 'campaign_id' = (select campaign_id from t_cred)::text;
update public.lm_campaign_categories set in_flight = 0, proxy_bytes = 0 where campaign_id = (select campaign_id from t_cred);
update public.lm_campaign_categories set kept = 80 where campaign_id = (select campaign_id from t_cred) and gcid = 'gcid:c_pricey';

set local role service_role;
select public.lm_schedule_discovery();
set local role postgres;

select is((select payload ->> 'gcid' from public.lm_tasks where kind = 'discovery' and status = 'queued'
            and payload ->> 'campaign_id' = (select campaign_id from t_cred)::text),
  'gcid:c_pricey', 'Sans trafic mesuré, l''activité aux meilleurs prospects par recherche passe d''abord');

select * from finish();

rollback;
