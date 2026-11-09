-- Isolation entre organisations pour les tables LeadMaker (lot 0).
-- Deux organisations A et B ; B ne doit jamais lire, écrire ou supprimer les données de A.
begin;

select no_plan();

select tests.create_supabase_user('owner_a', 'owner_a@test.com');
select tests.create_supabase_user('owner_b', 'owner_b@test.com');

set local role service_role;
select public.create_team_account('Org A', tests.get_supabase_uid('owner_a'), 'org-a');
select public.create_team_account('Org B', tests.get_supabase_uid('owner_b'), 'org-b');
set local role postgres;

insert into public.lm_plans (id, name, seats, spaces, discovery_credits, outreach_credits, active_campaigns, auto_validation)
values ('growth', 'Growth', 2, 3, 30000, 15000, 1, false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- Espace par défaut créé avec l'organisation
select makerkit.authenticate_as('owner_a');

select is(
  (select (count(*), count(*) filter (where is_default))::text from public.lm_spaces),
  '(1,1)', 'Chaque organisation reçoit son espace par défaut');

update public.lm_spaces set name = 'Client 1' where is_default;

delete from public.lm_spaces where is_default;
select is((select count(*)::int from public.lm_spaces where is_default), 1,
  'L''espace par défaut ne peut pas être supprimé');

-- Sans forfait : seulement l'espace par défaut
select throws_ok($$
  insert into public.lm_spaces (account_id, name, country_code)
  values ((select id from public.accounts where slug = 'org-a'), 'Client 2', 'FR')
$$, '23514', null, 'Sans forfait, un deuxième espace est refusé');

-- Un forfait Growth débloque 3 espaces
set local role service_role;
select public.lm_reset_credits((select id from public.accounts where slug = 'org-a'), 'growth', now() + interval '1 month', 'test:renewal:a');
set local role postgres;
select makerkit.authenticate_as('owner_a');

select lives_ok($$
  insert into public.lm_spaces (account_id, name, country_code)
  values ((select id from public.accounts where slug = 'org-a'), 'Client 2', 'US')
$$, 'Avec Growth, A crée un deuxième espace');

select is(
  (select discovery_balance from public.lm_account_credits where account_id = (select id from public.accounts where slug = 'org-a')),
  15000,
  'A lit son solde de crédits');

-- A ne peut pas écrire dans l'organisation B
select throws_ok($$
  insert into public.lm_spaces (account_id, name, country_code)
  values ((select id from public.accounts where slug = 'org-b'), 'Intrus', 'FR')
$$, '42501', null, 'A ne peut pas créer un espace chez B');

-- ---------------------------------------------------------------- Org B ne voit rien de A
select makerkit.authenticate_as('owner_b');

select is((select count(*)::int from public.lm_spaces where account_id = (select id from public.accounts where slug = 'org-a')), 0, 'B ne voit aucun espace de A');
select is((select count(*)::int from public.lm_account_credits), 0, 'B ne voit pas les crédits de A');
select is((select count(*)::int from public.lm_credit_ledger), 0, 'B ne voit pas le journal de crédits de A');

-- Mise à jour et suppression croisées : la RLS filtre, aucune ligne de A n'est touchée
select lives_ok($$ update public.lm_spaces set name = 'Piraté' where name = 'Client 1' $$, 'La mise à jour de B ne lève pas d''erreur');
select lives_ok($$ delete from public.lm_spaces where name = 'Client 2' $$, 'La suppression de B ne lève pas d''erreur');

select makerkit.authenticate_as('owner_a');
select is((select count(*)::int from public.lm_spaces where name = 'Client 1'), 1, 'B n''a pas modifié l''espace de A');
select is((select count(*)::int from public.lm_spaces where name = 'Client 2'), 1, 'B n''a pas supprimé l''espace de A');
select makerkit.authenticate_as('owner_b');

-- B ne peut pas rattacher un prospect à un espace de A, même avec son propre account_id
select throws_ok($$
  insert into public.lm_prospects (account_id, space_id, name, site_key)
  values ((select id from public.accounts where slug = 'org-b'),
          (select id from public.lm_spaces where name = 'Client 1'),
          'Intrus', 'intrus.example')
$$, '42501', null, 'B ne peut pas créer un prospect dans un espace de A');

-- La file de tâches n'est pas accessible en écriture aux utilisateurs
select throws_ok($$
  insert into public.lm_tasks (account_id, kind, idempotency_key)
  values ((select id from public.accounts where slug = 'org-b'), 'dummy', 'b:1')
$$, '42501', null, 'Un utilisateur ne peut pas insérer de tâche');

select throws_ok($$ select public.lm_claim_task(array['dummy']::public.lm_task_kind[], 'intrus') $$,
  '42501', null, 'Un utilisateur ne peut pas réserver de tâche');

select throws_ok($$ truncate public.lm_spaces $$, '42501', null, 'truncate est refusé aux utilisateurs');

-- ---------------------------------------------------------------- Service : crédits et tâches
set local role service_role;

select is(
  public.lm_debit_credits((select id from public.accounts where slug = 'org-a'), 'discovery', 10, 'test:debit:1', 'test'),
  true, 'Le service débite 10 crédits découverte');

select is(
  public.lm_debit_credits((select id from public.accounts where slug = 'org-a'), 'discovery', 10, 'test:debit:1', 'test'),
  false, 'Le même événement n''est pas débité deux fois');

select is(
  (select discovery_balance from public.lm_account_credits where account_id = (select id from public.accounts where slug = 'org-a')),
  14990, 'Le solde a baissé de 10 une seule fois');

select is(
  public.lm_debit_credits((select id from public.accounts where slug = 'org-b'), 'outreach', 1, 'test:debit:2', 'test'),
  false, 'Sans solde, le débit est refusé');

-- Un webhook de renouvellement reçu deux fois ne recrédite pas
select public.lm_reset_credits((select id from public.accounts where slug = 'org-a'), 'growth', now() + interval '1 month', 'test:renewal:a');

select is(
  (select discovery_balance from public.lm_account_credits where account_id = (select id from public.accounts where slug = 'org-a')),
  14990, 'Un renouvellement déjà traité ne remet pas le solde à zéro');

-- Résiliation effective : forfait et crédits retirés
insert into public.billing_customers (account_id, provider, customer_id)
values ((select id from public.accounts where slug = 'org-a'), 'stripe', 'cus_test_a');

insert into public.subscriptions (id, account_id, billing_customer_id, status, active, billing_provider,
  cancel_at_period_end, currency, period_starts_at, period_ends_at)
values ('sub_test_a', (select id from public.accounts where slug = 'org-a'),
  (select id from public.billing_customers where customer_id = 'cus_test_a'),
  'active', true, 'stripe', false, 'eur', now(), now() + interval '1 month');

-- le webhook de développement (seed) appelle l'API locale : on le coupe le temps du test
set local role postgres;
alter table public.subscriptions disable trigger subscriptions_delete;
set local role service_role;
delete from public.subscriptions where id = 'sub_test_a';

select is(
  (select (plan_id, discovery_balance, outreach_balance)::text from public.lm_account_credits
    where account_id = (select id from public.accounts where slug = 'org-a')),
  '(,0,0)', 'La résiliation retire le forfait et les crédits');

-- La base locale peut déjà contenir des tâches : on les écarte le temps du test (annulé au rollback)
update public.lm_tasks set status = 'cancelled' where status = 'queued';

insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
values ((select id from public.accounts where slug = 'org-a'), 'dummy', '{"hello": "world"}', 'a:dummy:1');

select is(
  (select kind::text from public.lm_claim_task(array['dummy']::public.lm_task_kind[], 'worker-test')),
  'dummy', 'Le service réserve la tâche en attente');

select is(
  (select count(*)::int from public.lm_claim_task(array['dummy']::public.lm_task_kind[], 'worker-test')),
  0, 'Une tâche réservée ne l''est pas deux fois');

select public.lm_complete_task((select id from public.lm_tasks where idempotency_key = 'a:dummy:1'), '{"ok": true}');

select is(
  (select status::text from public.lm_tasks where idempotency_key = 'a:dummy:1'),
  'done', 'La tâche terminée passe en done');

-- B ne voit pas les tâches de A
set local role postgres;
select makerkit.authenticate_as('owner_b');
select is((select count(*)::int from public.lm_tasks where idempotency_key = 'a:dummy:1'), 0, 'B ne voit pas les tâches de A');

select makerkit.authenticate_as('owner_a');
select is((select count(*)::int from public.lm_tasks where idempotency_key = 'a:dummy:1'), 1, 'A voit sa tâche');

select * from finish();

rollback;
