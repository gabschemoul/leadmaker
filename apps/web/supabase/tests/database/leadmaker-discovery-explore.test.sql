-- Roadmap n°12 : exploration limitée, exploitation des activités qui rapportent, abandon rapide.
begin;

select no_plan();

select tests.create_supabase_user('expl_a', 'expl_a@test.com');

set local role service_role;
select public.create_team_account('Expl A', tests.get_supabase_uid('expl_a'), 'expl-a');
set local role postgres;

-- Données de référence propres au test
insert into public.lm_plans (id, name, seats, spaces, discovery_credits, outreach_credits, daily_send_limit, active_campaigns, auto_validation)
values ('growth', 'Growth', 2, 3, 15000, 5000, 500, 1, false) on conflict (id) do nothing;
insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
insert into public.lm_country_coverage (country_code, name) values ('ZZ', 'Testland') on conflict do nothing;
insert into public.lm_geo_cities (geoname_id, name, ascii_name, country_code, population, latitude, longitude) values
  (990000001, 'Bigtown', 'Bigtown', 'ZZ', 500000, 10.0, 10.0)
on conflict do nothing;
insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded) values
  ('gcid:x_a', 'X alpha', 'X alpha', 'Test', false, false),
  ('gcid:x_b', 'X bravo', 'X bravo', 'Test', false, false),
  ('gcid:x_c', 'X charlie', 'X charlie', 'Test', false, false),
  ('gcid:x_d', 'X delta', 'X delta', 'Test', true, false),
  ('gcid:x_e', 'X echo', 'X echo', 'Test', false, false),
  ('gcid:x_f', 'X foxtrot', 'X foxtrot', 'Test', false, false),
  ('gcid:x_g', 'X golf', 'X golf', 'Test', false, false),
  ('gcid:x_h', 'X hotel', 'X hotel', 'Test', false, false)
on conflict do nothing;

-- Le test ne doit pas dépendre des campagnes déjà présentes en local
update public.lm_campaigns set status = 'paused' where status = 'running';

-- 4 places par campagne, 1 sur 4 pour l'exploration, abandon après 5 recherches sans prospect
update public.lm_discovery_settings set tasks_per_campaign = 4, explore_share = 0.25, abandon_zero_after = 5,
                                        min_searches = 40, min_rate = 0.05, prior = 5 where id;

select makerkit.authenticate_as('expl_a');

update public.lm_spaces set name = 'Espace Expl' where is_default and account_id = (select id from public.accounts where slug = 'expl-a');

insert into public.lm_campaigns (account_id, space_id, name, country_code, targeting, filters)
values ((select id from public.accounts where slug = 'expl-a'), (select id from public.lm_spaces where name = 'Espace Expl'),
        'Campagne Expl', 'ZZ',
        '{"cities":{"mode":"list","geoname_ids":[990000001]},"categories":{"mode":"list","gcids":["gcid:x_a","gcid:x_b","gcid:x_c","gcid:x_d","gcid:x_e","gcid:x_f","gcid:x_g","gcid:x_h"]}}',
        '{"rating_min":1}');

set local role service_role;
select public.lm_reset_credits((select id from public.accounts where slug = 'expl-a'), 'growth', now() + interval '1 month', 'expl:renewal:a');
set local role postgres;
-- Roadmap n°13 : le premier lancement exige une estimation terminée avec le même ciblage et les mêmes filtres
insert into public.lm_estimates (account_id, country_code, targeting, filters, mode, status, total_searches, sample_searches,
                                 done_searches, cards, matching, rate, credits_per_prospect, finished_at)
select account_id, country_code, targeting, filters - 'paused_reason', 'exact', 'done', 1, 1, 1, 100, 50, 0.5, 1, now()
  from public.lm_campaigns where name = 'Campagne Expl';

select makerkit.authenticate_as('expl_a');
select public.lm_start_campaign((select id from public.lm_campaigns where name = 'Campagne Expl'));

set local role postgres;

create temp table t_ctx as
  select id as campaign_id from public.lm_campaigns where name = 'Campagne Expl';
grant select on t_ctx to service_role;

select ok((select count(*) from public.lm_campaign_zones where campaign_id = (select campaign_id from t_ctx)) >= 8,
  'La grande ville donne au moins 8 secteurs');

-- Historique simulé : A rapporte beaucoup, B un peu, C rien après 2 recherches, D à H jamais essayées (D est générale)
update public.lm_campaign_categories set searches = 10, kept = 100, next_zone_idx = 3
 where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:x_a';
update public.lm_campaign_categories set searches = 10, kept = 20, next_zone_idx = 3
 where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:x_b';
update public.lm_campaign_categories set searches = 2, kept = 0, next_zone_idx = 2
 where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:x_c';

create temp view t_queued as
  select payload ->> 'gcid' as gcid, (payload ->> 'zone_idx')::int as zone_idx, status
    from public.lm_tasks
   where kind = 'discovery' and payload ->> 'campaign_id' = (select campaign_id from t_ctx)::text;

-- Planification
set local role service_role;
select is(public.lm_schedule_discovery(), 4, 'Quatre recherches planifiées (4 places)');
select is(public.lm_schedule_discovery(), 0, 'Pas de nouvelle recherche tant que les places sont prises');
set local role postgres;

select is((select count(*)::int from t_queued where gcid = 'gcid:x_a'), 3,
  'Exploitation : les 3 places restantes vont à l''activité qui rapporte le plus');
select is((select count(*)::int from t_queued where gcid = 'gcid:x_d'), 1,
  'Exploration : 1 place sur 4 pour une activité jamais essayée, les générales d''abord');
select is((select count(*)::int from t_queued where gcid in ('gcid:x_b', 'gcid:x_c')), 0,
  'Ni l''activité moyenne ni celle qui n''a rien donné ne sont servies tant que la meilleure a des zones');
select is((select (searches, in_flight, next_zone_idx)::text from public.lm_campaign_categories
            where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:x_a'),
  '(10,3,6)', 'Curseur de zone et recherches en cours de A');

-- Fin de l'exploration de D (rien trouvé) et d'une recherche de A : une nouvelle exploration part, et A continue
set local role service_role;
select public.lm_finish_search((select campaign_id from t_ctx), 'gcid:x_d', 0, 0, 0, 0, 1000);
select public.lm_finish_search((select campaign_id from t_ctx), 'gcid:x_a', 3, 50, 40, 5, 9000);
update public.lm_tasks set status = 'done', finished_at = now()
 where kind = 'discovery' and status = 'queued' and payload ->> 'campaign_id' = (select campaign_id from t_ctx)::text
   and ((payload ->> 'gcid' = 'gcid:x_d') or (payload ->> 'gcid' = 'gcid:x_a' and (payload ->> 'zone_idx')::int = 3));
select is(public.lm_schedule_discovery(), 2, 'Deux places libérées, deux recherches planifiées');
set local role postgres;

select is((select count(*)::int from t_queued where status = 'queued' and gcid in ('gcid:x_e', 'gcid:x_f', 'gcid:x_g', 'gcid:x_h')), 1,
  'Une nouvelle activité jamais essayée part en exploration');
select is((select count(*)::int from t_queued where status = 'queued' and gcid = 'gcid:x_a'), 3,
  'A garde ses places (2 en cours + 1 nouvelle)');
select is((select count(*)::int from t_queued where gcid = 'gcid:x_d'), 1,
  'D, essayée sans résultat, n''est pas relancée tant qu''il reste mieux');

-- Abandon : aucun prospect après 5 recherches
set local role service_role;
select public.lm_finish_search((select campaign_id from t_ctx), 'gcid:x_c', 2, 30, 30, 0, 1000);
select public.lm_finish_search((select campaign_id from t_ctx), 'gcid:x_c', 3, 30, 30, 0, 1000);
set local role postgres;
select is((select (searches, abandoned)::text from public.lm_campaign_categories
            where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:x_c'),
  '(4,f)', 'Après 4 recherches sans prospect, pas encore abandonnée');
set local role service_role;
select public.lm_finish_search((select campaign_id from t_ctx), 'gcid:x_c', 4, 30, 30, 0, 1000);
set local role postgres;
select is((select (searches, abandoned)::text from public.lm_campaign_categories
            where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:x_c'),
  '(5,t)', 'Abandonnée à la 5e recherche sans aucun prospect');

-- Un seul prospect suffit à ne pas être abandonnée par cette règle
update public.lm_campaign_categories set searches = 4, kept = 0
 where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:x_g';
set local role service_role;
select public.lm_finish_search((select campaign_id from t_ctx), 'gcid:x_g', 5, 30, 30, 1, 1000);
set local role postgres;
select is((select (searches, kept, abandoned)::text from public.lm_campaign_categories
            where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:x_g'),
  '(5,1,f)', 'Un prospect à la 5e recherche : l''activité continue');

-- L'ancienne règle reste : moins de 5 % par recherche après 40 recherches
update public.lm_campaign_categories set searches = 39, kept = 1
 where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:x_h';
set local role service_role;
select public.lm_finish_search((select campaign_id from t_ctx), 'gcid:x_h', 6, 30, 30, 0, 1000);
set local role postgres;
select is((select abandoned from public.lm_campaign_categories
            where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:x_h'),
  true, '1 prospect en 40 recherches : abandonnée (règle des 5 %)');

-- Une recherche échouée ne compte pas
set local role service_role;
select public.lm_release_search((select campaign_id from t_ctx), 'gcid:x_a');
set local role postgres;
select is((select (searches, in_flight)::text from public.lm_campaign_categories
            where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:x_a'),
  '(11,2)', 'Échec : place libérée, recherche non comptée');

-- Robot bloqué sur sa dernière tentative : la recherche passe en échec et libère sa place
update public.lm_tasks set status = 'running', worker_id = 'w-test', locked_at = now() - interval '1 hour',
                           attempts = max_attempts
 where id = (select id from public.lm_tasks where kind = 'discovery' and status = 'queued'
              and payload ->> 'campaign_id' = (select campaign_id from t_ctx)::text and payload ->> 'gcid' = 'gcid:x_a'
              limit 1);
set local role service_role;
select ok(public.lm_requeue_stale_tasks() >= 1, 'Une tâche bloquée balayée');
set local role postgres;
select is((select status::text from public.lm_tasks where kind = 'discovery' and error = 'worker timeout'
            and payload ->> 'campaign_id' = (select campaign_id from t_ctx)::text and payload ->> 'gcid' = 'gcid:x_a'),
  'failed', 'Dernière tentative : la tâche passe en échec');
select is((select (searches, in_flight)::text from public.lm_campaign_categories
            where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:x_a'),
  '(11,1)', 'Balayage : la recherche en échec définitif libère sa place');

-- Avancement : activités qui rapportent et abandonnées
select is((select (productive, abandoned)::text from public.lm_campaign_progress((select campaign_id from t_ctx))),
  '(4,2)', 'Avancement : 4 activités rapportent (A, B, G, H), 2 abandonnées (C, H)');

-- Campagne terminée quand plus rien n'est à chercher
update public.lm_campaign_categories set abandoned = true, in_flight = 0
 where campaign_id = (select campaign_id from t_ctx);
update public.lm_tasks set status = 'done', finished_at = now()
 where kind = 'discovery' and status = 'queued' and payload ->> 'campaign_id' = (select campaign_id from t_ctx)::text;
set local role service_role;
select is(public.lm_schedule_discovery(), 0, 'Plus rien à planifier');
set local role postgres;
select is((select status::text from public.lm_campaigns where id = (select campaign_id from t_ctx)), 'completed',
  'Toutes les activités abandonnées : campagne terminée');

select * from finish();

rollback;
