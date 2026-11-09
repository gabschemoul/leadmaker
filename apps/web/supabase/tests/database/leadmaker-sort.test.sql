-- 9/11/2026 : tri IA (CDC-PARCOURS-TRI-ANNUAIRE §4, étape 3). Une campagne avec une cible en mots met en file le
-- tri de ses entreprises ; un avis n'est gardé que pour la cible en cours ; le texte du site va dans l'annuaire ;
-- seuls les robots lancent le tri et rendent les avis.
begin;

select no_plan();

select tests.create_supabase_user('so_owner', 'so_owner@test.com');

set local role service_role;
select public.create_team_account('So A', tests.get_supabase_uid('so_owner'), 'so-a');
set local role postgres;

create temp view tso as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'so-a';
grant select on tso to authenticated, service_role;

insert into public.lm_account_credits (account_id, discovery_balance) select account_id, 100 from tso
on conflict (account_id) do update set discovery_balance = 100;

insert into public.lm_campaigns (id, account_id, space_id, name, country_code)
select 'f0000000-0000-4000-8000-0000000000a1'::uuid, account_id, space_id, 'Tri', 'FR' from tso;

set local role service_role;

-- 1. Sans cible : pas de tri
select public.lm_record_prospect('f0000000-0000-4000-8000-0000000000a1',
  '{"place_id":"so:1","name":"Agence Un","site_key":"un.fr","website":"https://un.fr"}');
select is((select count(*)::integer from public.lm_tasks where kind = 'sort'), 0, 'Sans cible : aucune tâche de tri');

-- 2. Lancement : cible + offre, version 1, tri des entreprises déjà là
select is(public.lm_start_sort('f0000000-0000-4000-8000-0000000000a1', '  Agences marketing  ', 'Sites Webflow en marque blanche'),
  1, 'Lancement : l''entreprise déjà trouvée est mise en file');
select is((select sort_target || ' / v' || sort_version from public.lm_campaigns where id = 'f0000000-0000-4000-8000-0000000000a1'),
  'Agences marketing / v1', 'Cible enregistrée (sans espaces), version 1');
select is((select offer from public.lm_spaces where id = (select space_id from tso)), 'Sites Webflow en marque blanche', 'Offre de l''espace enregistrée');
select is(public.lm_start_sort('f0000000-0000-4000-8000-0000000000a1', 'Agences marketing'), 0,
  'Même cible relancée : rien de plus en file');

-- 3. Nouvelle entreprise pendant que la campagne a une cible : triée au fil de l'eau
select public.lm_record_prospect('f0000000-0000-4000-8000-0000000000a1',
  '{"place_id":"so:2","name":"Agence Deux","site_key":"deux.fr","website":"https://deux.fr"}');
select is((select count(*)::integer from public.lm_tasks where kind = 'sort'), 2, 'Nouvelle entreprise : tri en file automatiquement');
select is((select payload ->> 'version' from public.lm_tasks where kind = 'sort' order by id desc limit 1), '1', 'Tâche à la version en cours');

-- 4. Avis rendu, texte du site gardé dans l'annuaire
select public.lm_record_search_places('{"country_code":"FR"}', '[{"place_id":"so:1","name":"Agence Un"}]');
select ok(public.lm_finish_sort('f0000000-0000-4000-8000-0000000000a1', (select id from public.lm_prospects where site_key = 'un.fr'),
  1, 'gardee', 'marketing_com', '  Agence de communication, pas de dev web  ', 'ok', 'Bienvenue chez Agence Un'), 'Avis enregistré');
select is((select verdict || ' | ' || group_key || ' | ' || reason || ' | v' || sorted_version from public.lm_campaign_prospects
            where prospect_id = (select id from public.lm_prospects where site_key = 'un.fr')),
  'gardee | marketing_com | Agence de communication, pas de dev web | v1', 'Verdict, groupe, raison et version');
select is((select site_status || ' | ' || site_text from public.lm_places where google_place_id = 'so:1'),
  'ok | Bienvenue chez Agence Un', 'Texte du site gardé dans l''annuaire');

-- 5. Nouvelle cible : nouvelle version, tout est retrié, un avis de l'ancienne version est ignoré
select is(public.lm_start_sort('f0000000-0000-4000-8000-0000000000a1', 'Agences de branding', null, 1), 1,
  'Nouvelle cible avec échantillon de 1 : une tâche');
select is((select sort_version from public.lm_campaigns where id = 'f0000000-0000-4000-8000-0000000000a1'), 2, 'Version 2');
select ok(not public.lm_finish_sort('f0000000-0000-4000-8000-0000000000a1', (select id from public.lm_prospects where site_key = 'deux.fr'),
  1, 'ecartee', null, 'ancien avis'), 'Avis de l''ancienne cible ignoré');
select is((select verdict from public.lm_campaign_prospects where prospect_id = (select id from public.lm_prospects where site_key = 'deux.fr')),
  null, 'Rien d''écrit pour l''ancienne cible');
select is((select offer from public.lm_spaces where id = (select space_id from tso)), 'Sites Webflow en marque blanche',
  'Offre gardée quand elle n''est pas redonnée');

-- 6. Entrées invalides
select throws_ok($$ select public.lm_finish_sort('f0000000-0000-4000-8000-0000000000a1',
  (select id from public.lm_prospects where site_key = 'un.fr'), 2, 'peut-etre', null, null) $$, 'P0001', null, 'Verdict inconnu refusé');
select throws_ok($$ select public.lm_start_sort('f0000000-0000-4000-8000-0000000000a1', '   ') $$, 'P0001', null, 'Cible vide refusée');

-- 7. Réservé aux robots
set local role postgres;
select makerkit.authenticate_as('so_owner');
select throws_ok($$ select public.lm_start_sort('f0000000-0000-4000-8000-0000000000a1', 'Tout le monde') $$, '42501', null,
  'Client : ne lance pas le tri lui-même (pour l''instant)');
select throws_ok($$ select public.lm_finish_sort('f0000000-0000-4000-8000-0000000000a1',
  (select id from public.lm_prospects where site_key = 'un.fr'), 2, 'gardee', null, 'moi') $$, '42501', null,
  'Client : ne rend pas d''avis lui-même');
select throws_ok($$ update public.lm_campaigns set sort_target = 'x' $$, '42501', null, 'Client : cible non modifiable en direct');
select throws_ok($$ update public.lm_spaces set offer = 'x' $$, '42501', null, 'Client : offre non modifiable en direct (pour l''instant)');

select * from finish();

rollback;
