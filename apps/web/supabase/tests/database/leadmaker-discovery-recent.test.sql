-- 3/11/2026 : « review cleaner » ralentissait. « Hôtel » avait bien rapporté au début puis plus rien dans les
-- secteurs déjà vus de Bruxelles, mais gardait toutes les places : le planificateur jugeait les activités sur
-- tout leur historique. Il les juge désormais sur leurs dernières recherches (moyenne glissante recent_kept).
begin;

select no_plan();

select tests.create_supabase_user('rec_a', 'rec_a@test.com');

set local role service_role;
select public.create_team_account('Rec A', tests.get_supabase_uid('rec_a'), 'rec-a');
set local role postgres;

insert into public.lm_plans (id, name, seats, spaces, discovery_credits, outreach_credits, active_campaigns, auto_validation)
values ('growth', 'Growth', 2, 3, 30000, 15000, 1, false) on conflict (id) do nothing;
insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
insert into public.lm_country_coverage (country_code, name) values ('ZZ', 'Testland') on conflict do nothing;
insert into public.lm_geo_cities (geoname_id, name, ascii_name, country_code, population, latitude, longitude) values
  (990000401, 'Recentville', 'Recentville', 'ZZ', 500000, 20.0, 20.0)
on conflict do nothing;
insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded) values
  ('gcid:r_old', 'R old', 'R ancienne', 'Test', false, false),
  ('gcid:r_new', 'R new', 'R nouvelle', 'Test', false, false)
on conflict do nothing;

-- Le test ne doit pas dépendre des campagnes déjà présentes en local
update public.lm_campaigns set status = 'paused' where status = 'running';

update public.lm_discovery_settings set tasks_per_campaign = 4, explore_share = 0.25, abandon_zero_after = 5,
                                        min_searches = 40, min_rate = 0.05, prior = 5, default_search_mb = 4 where id;

select makerkit.authenticate_as('rec_a');

update public.lm_spaces set name = 'Espace Rec' where is_default and account_id = (select id from public.accounts where slug = 'rec-a');

insert into public.lm_campaigns (account_id, space_id, name, country_code, targeting, filters)
values ((select id from public.accounts where slug = 'rec-a'), (select id from public.lm_spaces where name = 'Espace Rec'),
        'Campagne Rec', 'ZZ',
        '{"cities":{"mode":"list","geoname_ids":[990000401]},"categories":{"mode":"list","gcids":["gcid:r_old","gcid:r_new"]}}',
        '{"rating_min":1}');

set local role service_role;
select public.lm_reset_credits((select id from public.accounts where slug = 'rec-a'), 'growth', now() + interval '1 month', 'rec:renewal:a');
set local role postgres;
insert into public.lm_estimates (account_id, country_code, targeting, filters, mode, status, total_searches, sample_searches,
                                 done_searches, cards, matching, rate, credits_per_prospect, finished_at)
select account_id, country_code, targeting, filters - 'paused_reason', 'exact', 'done', 1, 1, 1, 100, 50, 0.5, 1, now()
  from public.lm_campaigns where name = 'Campagne Rec';

select makerkit.authenticate_as('rec_a');
select public.lm_start_campaign((select id from public.lm_campaigns where name = 'Campagne Rec'));

set local role postgres;

create temp table t_ctx as
  select id as campaign_id from public.lm_campaigns where name = 'Campagne Rec';
grant select on t_ctx to service_role;

select ok((select count(*) from public.lm_campaign_zones where campaign_id = (select campaign_id from t_ctx)) >= 8,
  'La grande ville donne au moins 8 secteurs');

-- « Ancienne » : 4 recherches à 15 prospects, puis 5 recherches à 0 (secteurs déjà vus).
-- « Nouvelle » : une seule recherche, 9 prospects.
set local role service_role;
select public.lm_finish_search((select campaign_id from t_ctx), 'gcid:r_old', i, 120, 100, case when i < 4 then 15 else 0 end, 30000)
  from generate_series(0, 8) i;
select public.lm_finish_search((select campaign_id from t_ctx), 'gcid:r_new', 0, 120, 110, 9, 30000);
set local role postgres;

update public.lm_campaign_categories set next_zone_idx = 1 where campaign_id = (select campaign_id from t_ctx);

create temp view t_queued as
  select payload ->> 'gcid' as gcid, status
    from public.lm_tasks
   where kind = 'discovery' and payload ->> 'campaign_id' = (select campaign_id from t_ctx)::text;

set local role service_role;
select is(public.lm_schedule_discovery(), 4, 'Quatre recherches planifiées (4 places)');
set local role postgres;

select ok((select count(*) from t_queued where gcid = 'gcid:r_new') >= 3,
  'L''activité qui rapporte en ce moment prend la plupart des places');
select ok((select count(*) from t_queued where gcid = 'gcid:r_old') <= 1,
  'L''activité épuisée (rien sur ses 5 dernières recherches) passe derrière, malgré son gros total');

-- Moyenne glissante : 15 sur les 4 premières recherches, puis × 0,7 à chaque recherche vide (poids 0,3)
select is((select round(recent_kept, 2) from public.lm_campaign_categories
            where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:r_old'),
  round(15 * 0.7 ^ 5, 2), 'Rendement récent de l''activité épuisée');
select is((select recent_kept from public.lm_campaign_categories
            where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:r_new'),
  9::numeric, 'Rendement récent après une seule recherche : son résultat');

-- Elle redevient bonne : elle remonte
set local role service_role;
select public.lm_finish_search((select campaign_id from t_ctx), 'gcid:r_old', 9, 120, 100, 30, 30000);
set local role postgres;
select ok((select recent_kept from public.lm_campaign_categories
            where campaign_id = (select campaign_id from t_ctx) and gcid = 'gcid:r_old') > 9,
  'Une activité qui se remet à rapporter remonte aussitôt');

select * from finish();

rollback;
