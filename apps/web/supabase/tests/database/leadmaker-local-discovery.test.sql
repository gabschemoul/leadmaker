-- 3/11/2026 : recherche Google Maps sur un ordinateur dédié (sans proxy), réservée à des utilisateurs précis.
-- Les robots des serveurs ne prennent plus les recherches des campagnes marquées et continuent de tout prendre
-- par ailleurs ; le robot de l'ordinateur ne prend QUE celles-là ; seuls les utilisateurs listés basculent.
begin;

select no_plan();

select tests.create_supabase_user('ld_a', 'ld_a@test.com');      -- autorisé, membre de l'organisation A
select tests.create_supabase_user('ld_a2', 'ld_a2@test.com');    -- membre de A, PAS autorisé
select tests.create_supabase_user('ld_b', 'ld_b@test.com');      -- autorisé, membre de B seulement

set local role service_role;
select public.create_team_account('LD A', tests.get_supabase_uid('ld_a'), 'ld-a');
select public.create_team_account('LD B', tests.get_supabase_uid('ld_b'), 'ld-b');
set local role postgres;

insert into public.accounts_memberships (account_id, user_id, account_role)
values ((select id from public.accounts where slug = 'ld-a'), tests.get_supabase_uid('ld_a2'), 'member');

insert into public.lm_local_discovery_users (user_id)
values (tests.get_supabase_uid('ld_a')), (tests.get_supabase_uid('ld_b'));

-- Deux campagnes dans A : C1 sera cherchée sur l'ordinateur dédié, C2 reste sur les serveurs
insert into public.lm_campaigns (id, account_id, space_id, name, country_code)
select v.id::uuid, a.id, (select s.id from public.lm_spaces s where s.account_id = a.id and s.is_default), v.n, 'FR'
  from public.accounts a, (values ('a0000000-0000-4000-8000-00000000d001', 'Locale'),
                                  ('a0000000-0000-4000-8000-00000000d002', 'Serveurs')) v(id, n)
 where a.slug = 'ld-a';

-- Les tâches de ce test passent avant toutes les autres (priorité très basse = prioritaire)
insert into public.lm_tasks (account_id, kind, payload, idempotency_key, priority)
select (select id from public.accounts where slug = 'ld-a'), v.kind::public.lm_task_kind, v.payload::jsonb, v.k, -100000 + v.o
  from (values
    ('discovery', '{"campaign_id":"a0000000-0000-4000-8000-00000000d001","gcid":"x"}', 'ld:local:1', 1),
    ('discovery', '{"campaign_id":"a0000000-0000-4000-8000-00000000d001","gcid":"y"}', 'ld:local:2', 2),
    ('discovery', '{"campaign_id":"a0000000-0000-4000-8000-00000000d002","gcid":"x"}', 'ld:server:1', 3),
    ('discovery', '{"campaign_id":"pas-un-uuid"}', 'ld:weird:1', 4),
    ('estimate',  '{"campaign_id":"a0000000-0000-4000-8000-00000000d001"}', 'ld:estimate:1', 5)
  ) v(kind, payload, k, o);

-- ---------------------------------------------------------------- Rien de marqué : comportement d'avant
set local role service_role;
select is((select idempotency_key from public.lm_claim_task(array['discovery']::public.lm_task_kind[], 'srv-0')),
  'ld:local:1', 'Sans campagne marquée, le robot des serveurs prend la première recherche comme avant');
set local role postgres;
update public.lm_tasks set status = 'queued', worker_id = null, locked_at = null, attempts = 0
 where idempotency_key = 'ld:local:1';

-- ---------------------------------------------------------------- Droits de bascule
select makerkit.authenticate_as('ld_a2');
select throws_ok($$ select public.lm_set_local_discovery('a0000000-0000-4000-8000-00000000d001', true) $$,
  '42501', null, 'Un membre non autorisé ne peut pas basculer la campagne');
select is((select public.lm_local_discovery_state('a0000000-0000-4000-8000-00000000d001') ->> 'allowed'), 'false',
  'Le membre non autorisé ne voit pas l''interrupteur');

select makerkit.authenticate_as('ld_b');
select throws_ok($$ select public.lm_set_local_discovery('a0000000-0000-4000-8000-00000000d001', true) $$,
  'P0002', null, 'Un utilisateur autorisé d''une autre organisation ne peut pas toucher la campagne');
select is(public.lm_local_discovery_state('a0000000-0000-4000-8000-00000000d001'), null,
  'Une autre organisation ne voit rien de la campagne');

select makerkit.authenticate_as('ld_a');
select is((select public.lm_local_discovery_state('a0000000-0000-4000-8000-00000000d001') ->> 'enabled'), 'false',
  'Campagne sur les serveurs par défaut');
select lives_ok($$ select public.lm_set_local_discovery('a0000000-0000-4000-8000-00000000d001', true) $$,
  'L''utilisateur autorisé bascule la campagne sur l''ordinateur dédié');
select lives_ok($$ select public.lm_set_local_discovery('a0000000-0000-4000-8000-00000000d001', true) $$,
  'Basculer deux fois ne plante pas');
select is((select public.lm_local_discovery_state('a0000000-0000-4000-8000-00000000d001') ->> 'enabled'), 'true',
  'La campagne est marquée');
select is((select public.lm_local_discovery_state('a0000000-0000-4000-8000-00000000d001') ->> 'allowed'), 'true',
  'L''utilisateur autorisé voit l''interrupteur');

-- Accès direct aux tables refusé (tout passe par les fonctions)
select throws_ok($$ select * from public.lm_local_discovery_campaigns $$, '42501', null,
  'Les campagnes marquées ne se lisent pas directement');
select throws_ok($$ insert into public.lm_local_discovery_users (user_id) values (auth.uid()) $$, '42501', null,
  'On ne s''ajoute pas soi-même à la liste des autorisés');
select throws_ok($$ select * from public.lm_claim_local_task('pirate') $$, '42501', null,
  'Un utilisateur ne peut pas réserver de tâche');
set local role postgres;

select ok(not has_table_privilege('authenticated', 'public.lm_local_discovery_users', 'TRUNCATE')
          and not has_table_privilege('anon', 'public.lm_local_discovery_campaigns', 'TRUNCATE')
          and not has_table_privilege('authenticated', 'public.lm_local_workers', 'SELECT'),
  'Aucun droit résiduel sur les nouvelles tables');
select ok(not has_function_privilege('anon', 'public.lm_set_local_discovery(uuid, boolean)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.lm_local_discovery_state(uuid)', 'EXECUTE'),
  'Les visiteurs non connectés ne peuvent rien appeler');

-- ---------------------------------------------------------------- Robots des serveurs
set local role service_role;
select is((select idempotency_key from public.lm_claim_task(array['discovery']::public.lm_task_kind[], 'srv-1')),
  'ld:server:1', 'Le robot des serveurs saute les recherches de la campagne marquée');
select is((select idempotency_key from public.lm_claim_task(array['discovery']::public.lm_task_kind[], 'srv-2')),
  'ld:weird:1', 'Une charge sans identifiant de campagne valide ne fait pas planter la réservation');
select is((select idempotency_key from public.lm_claim_task(array['estimate', 'discovery']::public.lm_task_kind[], 'srv-3')),
  'ld:estimate:1', 'Les autres types de tâches de la campagne restent sur les serveurs');
select is((select count(*)::int from public.lm_tasks where idempotency_key like 'ld:local:%' and status = 'queued'), 2,
  'Les recherches de la campagne marquée attendent le robot de l''ordinateur');

-- ---------------------------------------------------------------- Robot de l'ordinateur dédié
select is((select idempotency_key from public.lm_claim_local_task('mac-1')), 'ld:local:1',
  'Le robot de l''ordinateur prend la recherche de la campagne marquée');
select is((select worker_id from public.lm_tasks where idempotency_key = 'ld:local:1'), 'mac-1',
  'La recherche est à son nom');
select ok((select seen_at > now() - interval '1 minute' from public.lm_local_workers where worker_id = 'mac-1'),
  'Son signe de vie est noté');
select is((select idempotency_key from public.lm_claim_local_task('mac-1')), 'ld:local:2', 'Puis la suivante');
select is((select count(*)::int from public.lm_claim_local_task('mac-1')), 0,
  'Plus rien ensuite : il ne prend jamais les recherches des autres campagnes');
set local role postgres;

-- ---------------------------------------------------------------- Retour sur les serveurs
update public.lm_tasks set status = 'queued', worker_id = null, locked_at = null
 where idempotency_key = 'ld:local:2';
select makerkit.authenticate_as('ld_a');
select lives_ok($$ select public.lm_set_local_discovery('a0000000-0000-4000-8000-00000000d001', false) $$,
  'Retour de la campagne sur les serveurs');
set local role service_role;
select is((select idempotency_key from public.lm_claim_task(array['discovery']::public.lm_task_kind[], 'srv-4')),
  'ld:local:2', 'Les recherches en attente repartent sur les serveurs');
select is((select count(*)::int from public.lm_claim_local_task('mac-1')), 0,
  'Le robot de l''ordinateur ne prend plus rien de cette campagne');
set local role postgres;

-- Supprimer la campagne efface sa marque
select makerkit.authenticate_as('ld_a');
select public.lm_set_local_discovery('a0000000-0000-4000-8000-00000000d001', true);
set local role postgres;
delete from public.lm_campaigns where id = 'a0000000-0000-4000-8000-00000000d001';
select is((select count(*)::int from public.lm_local_discovery_campaigns
            where campaign_id = 'a0000000-0000-4000-8000-00000000d001'), 0, 'Campagne supprimée = marque effacée');

select * from finish();

rollback;
