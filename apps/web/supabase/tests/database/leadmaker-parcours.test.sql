-- 9/11/2026 : nouveau parcours campagne (CDC-PARCOURS-TRI-ANNUAIRE §3 et §6, étape 5). Cible et offre posées par
-- un membre ; « Garder » / « Écarter » seulement sur les entreprises « À vérifier » (garder = payer) ; résumé du tri
-- sans les écartées ; dans une campagne triée, seules les entreprises gardées et payées sont contactables.
begin;

select no_plan();

select tests.create_supabase_user('pa_owner', 'pa_owner@test.com');
select tests.create_supabase_user('pa_other', 'pa_other@test.com');

set local role service_role;
select public.create_team_account('Pa A', tests.get_supabase_uid('pa_owner'), 'pa-a');
set local role postgres;

create temp view tpa as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'pa-a';
grant select on tpa to authenticated, service_role;

update public.lm_discovery_settings set sort_measure_size = 2 where id;
insert into public.lm_account_credits (account_id, plan_id, discovery_balance) select account_id, 'growth', 50 from tpa
on conflict (account_id) do update set plan_id = 'growth', discovery_balance = 50;

insert into public.lm_campaigns (id, account_id, space_id, name, country_code, status)
select 'e2000000-0000-4000-8000-0000000000a1'::uuid, account_id, space_id, 'Parcours', 'FR', 'running' from tpa;

create function pg_temp.pid(p_key text) returns uuid language sql as $$ select id from public.lm_prospects where site_key = p_key $$;
grant execute on function pg_temp.pid(text) to authenticated, service_role;

-- 1. Cible et offre posées par un membre ; refusées à un autre utilisateur
select makerkit.authenticate_as('pa_owner');
select is(public.lm_set_sort_target('e2000000-0000-4000-8000-0000000000a1', 'Agences de communication'), 0, 'Cible posée par le membre');
select lives_ok($$ select public.lm_set_space_offer((select space_id from tpa), '  Sites Webflow en marque blanche ') $$, 'Offre posée');
select makerkit.authenticate_as('pa_other');
select throws_ok($$ select public.lm_set_sort_target('e2000000-0000-4000-8000-0000000000a1', 'Tout') $$, 'P0002', null, 'Autre utilisateur : cible refusée');
select throws_ok($$ select public.lm_set_space_offer((select space_id from tpa), 'x') $$, 'P0002', null, 'Autre utilisateur : offre refusée');
select is((select count(*)::integer from public.lm_campaign_sort_summary('e2000000-0000-4000-8000-0000000000a1')), 0, 'Autre utilisateur : aucun résumé');

-- 2. Entreprises trouvées et triées : g1 gardée, g2 écartée, v1 et v2 à vérifier ; prix mesuré (1 sur 2 = 50 % → 1 crédit)
set local role service_role;
select public.lm_record_prospect('e2000000-0000-4000-8000-0000000000a1',
  format('{"place_id":"pa:%s","name":"Entreprise %s","site_key":"%s.fr","website":"https://%s.fr"}', n, n, n, n)::jsonb)
  from unnest(array['g1', 'g2', 'v1', 'v2']) n;
select public.lm_finish_sort('e2000000-0000-4000-8000-0000000000a1', pg_temp.pid(n || '.fr'), 1, v, null, 'raison ' || n)
  from (values ('g1', 'gardee'), ('g2', 'ecartee'), ('v1', 'a_verifier'), ('v2', 'a_verifier')) x(n, v);

select makerkit.authenticate_as('pa_owner');
select is((select row(sort_target, offer, total, kept, to_check, pending, credits_per_prospect, price_pending)::text
             from public.lm_campaign_sort_summary('e2000000-0000-4000-8000-0000000000a1')),
  '("Agences de communication","Sites Webflow en marque blanche",4,1,2,0,1,f)', 'Résumé : 1 gardée, 2 à vérifier, écartée non comptée, 1 crédit');

-- 3. Seule la gardée (payée) est contactable
select is(public.lm_autopilot_contactable('e2000000-0000-4000-8000-0000000000a1'), 1, 'Campagne triée : seule la gardée est contactable');

-- 4. « Garder » une entreprise à vérifier : payée, devient contactable ; « Écarter » : gratuite
select is(public.lm_choose_prospects('e2000000-0000-4000-8000-0000000000a1', array[pg_temp.pid('v1.fr')], 'gardee'), 1, 'Gardée par le client');
select is((select discovery_balance from public.lm_account_credits where account_id = (select account_id from tpa)), 48,
  'Payée (1 crédit, comme la gardée par le tri)');
select is(public.lm_autopilot_contactable('e2000000-0000-4000-8000-0000000000a1'), 2, 'Devient contactable');
select is(public.lm_choose_prospects('e2000000-0000-4000-8000-0000000000a1', array[pg_temp.pid('v2.fr')], 'ecartee'), 1, 'Écartée par le client');
select is((select discovery_balance from public.lm_account_credits where account_id = (select account_id from tpa)), 48, 'Écartée : gratuite');

-- 5. Pas de bouton sur les gardées ni les écartées par le tri ; choix inconnu refusé ; autre utilisateur sans effet
select is(public.lm_choose_prospects('e2000000-0000-4000-8000-0000000000a1', array[pg_temp.pid('g1.fr'), pg_temp.pid('g2.fr')], 'ecartee'), 0,
  'Gardée ou écartée par le tri : rien ne change');
select throws_ok($$ select public.lm_choose_prospects('e2000000-0000-4000-8000-0000000000a1', array[pg_temp.pid('v1.fr')], 'peut-etre') $$,
  'P0001', null, 'Choix inconnu refusé');
select makerkit.authenticate_as('pa_other');
select throws_ok($$ select public.lm_choose_prospects('e2000000-0000-4000-8000-0000000000a1', array[pg_temp.pid('v1.fr')], 'ecartee') $$,
  'P0002', null, 'Autre utilisateur : refusé');

-- 6. Garantie : une entreprise rattachée à une campagne par un autre chemin a toujours son lien
set local role postgres;
insert into public.lm_prospects (account_id, space_id, campaign_id, name, site_key)
select account_id, space_id, 'e2000000-0000-4000-8000-0000000000a1', 'Directe', 'directe.fr' from tpa;
select ok(exists (select 1 from public.lm_campaign_prospects where prospect_id = pg_temp.pid('directe.fr')), 'Lien posé automatiquement');

-- 7. Plafond des propositions de l'IA : permis jusqu'à la limite, puis refusé ; jamais pour une autre organisation
select makerkit.authenticate_as('pa_owner');
select is((select row(allowed, remaining)::text from public.lm_take_ai_quota((select account_id from tpa), 'message', 2)), '(t,1)', '1re proposition : permise, 1 restante');
select is((select row(allowed, remaining)::text from public.lm_take_ai_quota((select account_id from tpa), 'message', 2)), '(t,0)', '2e : permise, plus rien');
select is((select row(allowed, remaining)::text from public.lm_take_ai_quota((select account_id from tpa), 'message', 2)), '(f,0)', '3e : plafond atteint');
select is((select row(allowed, remaining)::text from public.lm_take_ai_quota((select account_id from tpa), 'other', 2)), '(t,1)', 'Autre fonction : son propre compteur');
select throws_ok($$ select * from public.lm_ai_usage $$, '42501', null, 'Compteurs illisibles pour le client');
select makerkit.authenticate_as('pa_other');
select throws_ok($$ select * from public.lm_take_ai_quota((select account_id from tpa), 'message', 30) $$, 'P0002', null, 'Autre utilisateur : refusé');

select * from finish();

rollback;
