-- 11/11/2026, retours de Gabriel sur la recherche d'une campagne :
--  * « Abbaye à Barcelone » terminée à « 10 recherches faites sur 46 » : l'activité était abandonnée faute de
--    résultats. Désormais toutes les recherches sont faites (plus d'abandon), et une activité abandonnée avant ce
--    changement ne compte que ses recherches faites ;
--  * « Abbaye à Villeurbanne » modifiée en Lyon : bloquée à « 10 sur 22 », rien ne repartait (activité restée
--    abandonnée, recherches des villes retirées toujours comptées) ;
--  * campagne triée : plus de recherches d'essai (son prix vient du tri), elles passaient avant ses vraies
--    recherches ;
--  * « 0 recherche faite » pendant 1 à 2 minutes : lm_campaign_search_phase dit où en est le lancement.
begin;

select no_plan();

select tests.create_supabase_user('sp_a', 'sp_a@test.com');
select tests.create_supabase_user('sp_b', 'sp_b@test.com');

set local role service_role;
select public.create_team_account('SP A', tests.get_supabase_uid('sp_a'), 'sp-a');
select public.create_team_account('SP B', tests.get_supabase_uid('sp_b'), 'sp-b');
set local role postgres;

insert into public.lm_plans (id, name, seats, spaces, discovery_credits, outreach_credits, active_campaigns, auto_validation)
values ('growth', 'Growth', 2, 3, 30000, 15000, 1, false) on conflict (id) do nothing;
insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
-- règles d'abandon les plus sévères : elles ne doivent plus jouer
update public.lm_discovery_settings set abandon_zero_after = 1, min_searches = 1, sort_abandon_after = 1 where id;
insert into public.lm_country_coverage (country_code, name) values ('ZZ', 'Testland') on conflict do nothing;
insert into public.lm_geo_cities (geoname_id, name, ascii_name, country_code, population, latitude, longitude) values
  (990000102, 'Bronville', 'Bronville', 'ZZ', 2000, 10.05, 10.05),
  (990000104, 'Villeurville', 'Villeurville', 'ZZ', 1500, 12.0, 12.0),
  (990000105, 'Lyonville', 'Lyonville', 'ZZ', 800, 13.0, 13.0),
  (990000106, 'Nouvelleville', 'Nouvelleville', 'ZZ', 700, 14.0, 14.0)
on conflict do nothing;
insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded) values
  ('gcid:test_abbey', 'Test abbey', 'Abbaye test', 'Religion', true, false),
  ('gcid:test_shop', 'Test shop', 'Boutique test', 'Commerces', false, false),
  ('gcid:test_old', 'Test old', 'Ancienne test', 'Commerces', false, false)
on conflict do nothing;

update public.lm_campaigns set status = 'paused' where status = 'running';
update public.lm_tasks set status = 'done' where status in ('queued', 'running');

set local role service_role;
select public.lm_reset_credits((select id from public.accounts where slug = 'sp-a'), 'growth', now() + interval '1 month', 'sp:renewal:a');
set local role postgres;

select makerkit.authenticate_as('sp_a');

insert into public.lm_campaigns (id, account_id, space_id, name, country_code, targeting, filters)
values ('a0000000-0000-4000-8000-00000000f001',
        (select id from public.accounts where slug = 'sp-a'),
        (select id from public.lm_spaces where account_id = (select id from public.accounts where slug = 'sp-a') and is_default),
        'Abbayes', 'ZZ',
        '{"cities":{"mode":"list","geoname_ids":[990000102,990000104]},"categories":{"mode":"list","gcids":["gcid:test_abbey"]}}',
        '{"rating_min":1,"rating_max":5,"website":"all"}');

-- Campagne triée (cible en mots) : lancée sans recherche d'essai
select public.lm_set_sort_target('a0000000-0000-4000-8000-00000000f001', 'Abbayes ouvertes au public');
select public.lm_start_campaign('a0000000-0000-4000-8000-00000000f001');
select is((select (estimate_id is null, price_pending)::text from public.lm_campaigns
            where id = 'a0000000-0000-4000-8000-00000000f001'),
  '(t,t)', 'Campagne triée : aucune recherche d''essai, prix mesuré par le tri');
set local role postgres;
select is((select count(*)::int from public.lm_tasks t
            where t.kind = 'estimate' and t.account_id = (select id from public.accounts where slug = 'sp-a')),
  0, 'Aucune tâche d''essai en file pour ce compte');
select makerkit.authenticate_as('sp_a');

-- Lancement : rien en file tant que les robots n'ont pas planifié
select is((select (queued, running, ahead)::text from public.lm_campaign_search_phase('a0000000-0000-4000-8000-00000000f001')),
  '(0,0,0)', 'Juste après le lancement : aucune recherche en file (préparation)');

set local role service_role;
select public.lm_schedule_discovery();
set local role postgres;
select makerkit.authenticate_as('sp_a');
select ok((select queued > 0 and running = 0 and ahead = 0 and resume_at is null
             from public.lm_campaign_search_phase('a0000000-0000-4000-8000-00000000f001')),
  'Planifiée : recherches en file, aucune autre avant elles');

-- Les deux recherches ne trouvent aucune abbaye : l'activité n'est PAS abandonnée, les deux villes sont faites
set local role service_role;
select is((select count(*)::int from public.lm_tasks where kind = 'discovery' and status = 'queued'
            and payload ->> 'campaign_id' = 'a0000000-0000-4000-8000-00000000f001'),
  2, 'Les deux villes sont planifiées');
update public.lm_tasks set status = 'done', finished_at = now()
 where kind = 'discovery' and payload ->> 'campaign_id' = 'a0000000-0000-4000-8000-00000000f001';
update public.lm_campaign_categories set in_flight = 0 where campaign_id = 'a0000000-0000-4000-8000-00000000f001';
select public.lm_finish_search('a0000000-0000-4000-8000-00000000f001', 'gcid:test_abbey', 0, 40, 40, 0, 1000);
select public.lm_finish_search('a0000000-0000-4000-8000-00000000f001', 'gcid:test_abbey', 1, 40, 40, 0, 1000);
select is((select abandoned from public.lm_campaign_categories where campaign_id = 'a0000000-0000-4000-8000-00000000f001'),
  false, 'Aucun résultat : l''activité n''est plus abandonnée (toutes les recherches sont faites)');
select public.lm_schedule_discovery();
select is((select (status::text) from public.lm_campaigns where id = 'a0000000-0000-4000-8000-00000000f001'),
  'completed', 'Toutes les villes cherchées : campagne terminée');

set local role postgres;
select makerkit.authenticate_as('sp_a');
select is((select (zones, searches_done, searches_total, abandoned)::text
             from public.lm_campaign_progress('a0000000-0000-4000-8000-00000000f001')),
  '(2,2,2,0)', 'Terminée : « 2 recherches faites sur 2 »');

-- Activités abandonnées avant ce changement : sans aucun prospect / avec des prospects
set local role postgres;
insert into public.lm_campaign_categories (campaign_id, gcid, account_id, searches, kept, abandoned, next_zone_idx)
select 'a0000000-0000-4000-8000-00000000f001', v.g, c.account_id, 0, v.k, true, 2
  from public.lm_campaigns c, (values ('gcid:test_old', 0), ('gcid:test_shop', 1)) v(g, k)
 where c.id = 'a0000000-0000-4000-8000-00000000f001';
select makerkit.authenticate_as('sp_a');

-- Modification : les deux villes retirées, Lyonville ajoutée → la campagne repart
select is(public.lm_update_campaign('a0000000-0000-4000-8000-00000000f001', 'Abbayes', 'ZZ',
  '{"cities":{"mode":"list","geoname_ids":[990000105]},"categories":{"mode":"list","gcids":["gcid:test_abbey","gcid:test_old","gcid:test_shop"]}}',
  '{"rating_min":1,"rating_max":5,"website":"all"}'), 'paused', 'Nouvelle ville : la campagne terminée repasse en pause (prête à reprendre)');
select is((select (abandoned, next_zone_idx = (select pos from public.lm_campaign_zones
                                                where campaign_id = 'a0000000-0000-4000-8000-00000000f001' and geoname_id = 990000105))::text
             from public.lm_campaign_categories
            where campaign_id = 'a0000000-0000-4000-8000-00000000f001' and gcid = 'gcid:test_old'),
  '(f,t)', 'Ancienne activité abandonnée sans aucun prospect : repart, directement sur la nouvelle ville');
select is((select (abandoned, next_zone_idx)::text from public.lm_campaign_categories
            where campaign_id = 'a0000000-0000-4000-8000-00000000f001' and gcid = 'gcid:test_shop'),
  '(t,2)', 'Ancienne activité abandonnée avec des prospects : reste abandonnée');
select is((select (zones, searches_done, searches_total)::text
             from public.lm_campaign_progress('a0000000-0000-4000-8000-00000000f001')),
  '(1,0,2)', '« 0 recherche faite sur 2 » : les recherches des villes retirées ne comptent plus');
select is((select estimate_id is null from public.lm_campaigns where id = 'a0000000-0000-4000-8000-00000000f001'),
  true, 'Campagne triée modifiée : toujours pas de recherche d''essai');

select lives_ok($$ select public.lm_start_campaign('a0000000-0000-4000-8000-00000000f001') $$, 'Reprise acceptée');
set local role service_role;
select public.lm_schedule_discovery();
select is((select count(*)::int from public.lm_tasks t
            join public.lm_campaign_zones z on z.campaign_id = (t.payload ->> 'campaign_id')::uuid
                                           and z.idx = (t.payload ->> 'zone_idx')::int
           where t.kind = 'discovery' and t.status = 'queued'
             and t.payload ->> 'campaign_id' = 'a0000000-0000-4000-8000-00000000f001' and z.geoname_id = 990000105),
  2, 'Les deux activités cherchent dans la nouvelle ville');

-- Ville ajoutée en gardant une ancienne : rien n'est compté deux fois
update public.lm_tasks set status = 'done', finished_at = now()
 where kind = 'discovery' and payload ->> 'campaign_id' = 'a0000000-0000-4000-8000-00000000f001';
update public.lm_campaign_categories set in_flight = 0 where campaign_id = 'a0000000-0000-4000-8000-00000000f001';
select public.lm_finish_search('a0000000-0000-4000-8000-00000000f001', v.g,
  (select idx from public.lm_campaign_zones where campaign_id = 'a0000000-0000-4000-8000-00000000f001' and geoname_id = 990000105),
  10, 10, 0, 1000)
  from (values ('gcid:test_abbey'), ('gcid:test_old')) v(g);
set local role postgres;
select makerkit.authenticate_as('sp_a');
select public.lm_update_campaign('a0000000-0000-4000-8000-00000000f001', 'Abbayes', 'ZZ',
  '{"cities":{"mode":"list","geoname_ids":[990000102,990000105,990000106]},"categories":{"mode":"list","gcids":["gcid:test_abbey","gcid:test_old","gcid:test_shop"]}}',
  '{"rating_min":1,"rating_max":5,"website":"all"}');
-- abbaye : Bronville + Lyonville faites, Nouvelleville à faire (3) ; ancienne : Lyonville faite, Nouvelleville à
-- faire (Bronville sautée, déjà jugée vide) (2) ; boutique abandonnée : rien (0)
select is((select (zones, searches_done, searches_total)::text
             from public.lm_campaign_progress('a0000000-0000-4000-8000-00000000f001')),
  '(3,3,5)', '3 villes ciblées : 3 recherches faites sur 5');

-- Isolation
select makerkit.authenticate_as('sp_b');
select is((select count(*)::int from public.lm_campaign_search_phase('a0000000-0000-4000-8000-00000000f001')), 0,
  'Une autre organisation ne voit rien du lancement');
set local role postgres;
select ok(not has_function_privilege('anon', 'public.lm_campaign_search_phase(uuid)', 'EXECUTE'),
  'Les visiteurs non connectés ne peuvent pas l''appeler');
select ok((select prosecdef from pg_proc where oid = 'public.lm_campaign_search_phase(uuid)'::regprocedure),
  'Lit la file des robots une fois (SECURITY DEFINER), droits vérifiés par lm_member');

select * from finish();

rollback;
