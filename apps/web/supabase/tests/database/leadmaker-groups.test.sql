-- 10/11/2026 : groupes (CDC-PARCOURS-TRI-ANNUAIRE §4.3). Après assez de gardées, une tâche propose des groupes ;
-- les gardées sont classées ; l'encart voit les gardées par groupe ; « Un seul message » ; « Créer N campagnes »
-- crée une campagne par groupe avec ses entreprises déjà trouvées, sans nouvelle recherche ni nouveau débit.
begin;

select no_plan();

select tests.create_supabase_user('gr_owner', 'gr_owner@test.com');
select tests.create_supabase_user('gr_other', 'gr_other@test.com');

set local role service_role;
select public.create_team_account('Gr A', tests.get_supabase_uid('gr_owner'), 'gr-a');
set local role postgres;

create temp view tgr as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'gr-a';
grant select on tgr to authenticated, service_role;

update public.lm_discovery_settings set sort_measure_size = 2, sort_groups_after = 3 where id;
insert into public.lm_account_credits (account_id, plan_id, discovery_balance) select account_id, 'growth', 100 from tgr
on conflict (account_id) do update set plan_id = 'growth', discovery_balance = 100;
insert into public.lm_campaigns (id, account_id, space_id, name, country_code, status)
select 'e3000000-0000-4000-8000-0000000000a1'::uuid, account_id, space_id, 'Agences', 'FR', 'running' from tgr;

create function pg_temp.pid(p_key text) returns uuid language sql as $$ select id from public.lm_prospects where site_key = p_key $$;
grant execute on function pg_temp.pid(text) to authenticated, service_role;

set local role service_role;
select public.lm_start_sort('e3000000-0000-4000-8000-0000000000a1', 'Agences de communication');
select public.lm_record_prospect('e3000000-0000-4000-8000-0000000000a1',
  format('{"place_id":"gr:%s","name":"Agence %s","site_key":"%s.fr","website":"https://%s.fr"}', n, n, n, n)::jsonb)
  from unnest(array['m1', 'm2', 'b1', 'x1']) n;

-- 1. Deux gardées : pas encore de proposition ; la troisième déclenche une seule tâche de proposition
select public.lm_finish_sort('e3000000-0000-4000-8000-0000000000a1', pg_temp.pid(n || '.fr'), 1, 'gardee', null, 'raison ' || n)
  from unnest(array['m1', 'm2']) n;
select is((select count(*)::integer from public.lm_tasks where payload ->> 'action' = 'groups'), 0, '2 gardées : pas de groupes');
select public.lm_finish_sort('e3000000-0000-4000-8000-0000000000a1', pg_temp.pid('b1.fr'), 1, 'gardee', null, 'raison b1');
select public.lm_finish_sort('e3000000-0000-4000-8000-0000000000a1', pg_temp.pid('x1.fr'), 1, 'ecartee', null, 'hors cible');
select is((select count(*)::integer from public.lm_tasks where payload ->> 'action' = 'groups'), 1, '3 gardées : une tâche de proposition');

-- 2. Groupes enregistrés : chaque gardée sans groupe est mise en file de classement (pas l'écartée)
select throws_ok($$ select public.lm_set_sort_groups('e3000000-0000-4000-8000-0000000000a1', 1, '[{"key":"seul","label":"Seul"}]') $$,
  'P0001', null, 'Un seul groupe : refusé');
select is(public.lm_set_sort_groups('e3000000-0000-4000-8000-0000000000a1', 1,
  '[{"key":"marketing","label":"Marketing"},{"key":"branding","label":"Branding"}]'), 3, 'Groupes posés : 3 gardées à classer');
select is(public.lm_set_sort_groups('e3000000-0000-4000-8000-0000000000a1', 1,
  '[{"key":"a","label":"A"},{"key":"b","label":"B"}]'), 0, 'Groupes déjà là : rien ne change');

-- 3. Classement
select ok(public.lm_finish_sort_group('e3000000-0000-4000-8000-0000000000a1', pg_temp.pid('m1.fr'), 1, 'marketing'), 'm1 → marketing');
select ok(public.lm_finish_sort_group('e3000000-0000-4000-8000-0000000000a1', pg_temp.pid('m2.fr'), 1, 'marketing'), 'm2 → marketing');
select ok(public.lm_finish_sort_group('e3000000-0000-4000-8000-0000000000a1', pg_temp.pid('b1.fr'), 1, 'branding'), 'b1 → branding');
select ok(not public.lm_finish_sort_group('e3000000-0000-4000-8000-0000000000a1', pg_temp.pid('b1.fr'), 1, 'inconnu'), 'Groupe inconnu : ignoré');

-- 4. Encart : gardées par groupe
select makerkit.authenticate_as('gr_owner');
select is((select string_agg(group_key || '=' || kept || '/' || total_kept, ',') from public.lm_campaign_groups('e3000000-0000-4000-8000-0000000000a1')),
  'marketing=2/3,branding=1/3', 'Gardées par groupe');
select lives_ok($$ select public.lm_set_groups_choice('e3000000-0000-4000-8000-0000000000a1', 'single') $$, '« Un seul message »');
select is((select distinct choice from public.lm_campaign_groups('e3000000-0000-4000-8000-0000000000a1')), 'single', 'Choix gardé');
select lives_ok($$ select public.lm_set_groups_choice('e3000000-0000-4000-8000-0000000000a1', null) $$, '« Changer » : on revient sur le choix');

-- 5. « Créer 2 campagnes » : une par groupe, avec ses gardées, sans tri ni débit
create temp table t_bal as select discovery_balance from public.lm_account_credits where account_id = (select account_id from tgr);
grant select on t_bal to authenticated;
create temp table t_split as select * from public.lm_split_campaign_by_groups('e3000000-0000-4000-8000-0000000000a1');
grant select on t_split to authenticated, service_role;
select is((select string_agg(label || '=' || companies, ',' order by label) from t_split), 'Branding=1,Marketing=2', 'Une campagne par groupe, avec ses gardées');
select is((select string_agg(c.name || ' / ' || c.status || ' / ' || c.sort_target, ',' order by c.name)
             from public.lm_campaigns c join t_split s on s.campaign_id = c.id),
  'Agences · Branding / draft / Agences de communication,Agences · Marketing / draft / Agences de communication',
  'Copies en brouillon, même cible');
select is((select count(*)::integer from public.lm_campaign_prospects cp join t_split s on s.campaign_id = cp.campaign_id
            where cp.verdict = 'gardee' and cp.paid_at is not null and cp.reason like 'raison %'), 3, 'Avis et raisons recopiés, déjà payées');
select is((select discovery_balance from public.lm_account_credits where account_id = (select account_id from tgr)),
  (select discovery_balance from t_bal), 'Rien de redébité');
set local role postgres;
select is((select count(*)::integer from public.lm_tasks t join t_split s on t.payload ->> 'campaign_id' = s.campaign_id::text), 0,
  'Aucune nouvelle recherche ni nouveau tri pour les copies');
select makerkit.authenticate_as('gr_owner');
select is(public.lm_autopilot_contactable((select campaign_id from t_split where group_key = 'marketing')), 2,
  'La copie « Marketing » peut contacter ses 2 gardées');
select throws_ok($$ select * from public.lm_split_campaign_by_groups('e3000000-0000-4000-8000-0000000000a1') $$, 'P0001', null, 'Une seule fois');

-- 6. Autre utilisateur : rien
select makerkit.authenticate_as('gr_other');
select is((select count(*)::integer from public.lm_campaign_groups('e3000000-0000-4000-8000-0000000000a1')), 0, 'Autre utilisateur : aucun groupe visible');
select throws_ok($$ select public.lm_set_groups_choice('e3000000-0000-4000-8000-0000000000a1', 'single') $$, 'P0002', null, 'Autre utilisateur : choix refusé');
select throws_ok($$ select * from public.lm_split_campaign_by_groups('e3000000-0000-4000-8000-0000000000a1') $$, 'P0002', null, 'Autre utilisateur : découpage refusé');
select throws_ok($$ select public.lm_set_sort_groups('e3000000-0000-4000-8000-0000000000a1', 1, '[]') $$, '42501', null, 'Client : ne pose pas les groupes');

select * from finish();

rollback;
