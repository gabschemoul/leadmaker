-- 10/11/2026 : packs de crédits (roadmap n°5). Un pack par commande Stripe, valable 12 mois ; les crédits du
-- forfait partent d'abord, puis ceux des packs (le plus proche de son expiration d'abord) ; jamais visibles ni
-- ajoutables par un autre client.
begin;

select no_plan();

select tests.create_supabase_user('cp_owner', 'cp_owner@test.com');
select tests.create_supabase_user('cp_other', 'cp_other@test.com');

set local role service_role;
select public.create_team_account('Cp A', tests.get_supabase_uid('cp_owner'), 'cp-a');
select public.create_team_account('Cp B', tests.get_supabase_uid('cp_other'), 'cp-b');
set local role postgres;

create temp view tcp as select a.id as account_id from public.accounts a where a.slug = 'cp-a';
grant select on tcp to authenticated, service_role;

insert into public.lm_account_credits (account_id, plan_id, discovery_balance) select account_id, 'growth', 5 from tcp
on conflict (account_id) do update set plan_id = 'growth', discovery_balance = 5;

create function pg_temp.bal() returns integer language sql as $$
  select discovery_balance from public.lm_account_credits where account_id = (select account_id from tcp) $$;
create function pg_temp.left_in(p_order text) returns integer language sql as $$
  select remaining from public.lm_credit_packs where order_ref = p_order $$;
grant execute on function pg_temp.bal() to service_role, authenticated;
grant execute on function pg_temp.left_in(text) to service_role, authenticated;

set local role service_role;

-- 1. Achat : une seule fois par commande, noté au journal
select ok(public.lm_grant_credit_pack((select account_id from tcp), 'pack-s', 10, 'ord_1'), 'Pack ajouté');
select ok(not public.lm_grant_credit_pack((select account_id from tcp), 'pack-s', 10, 'ord_1'), 'Même commande : rien de plus');
select is((select count(*)::integer from public.lm_credit_ledger where event_ref = 'pack:ord_1' and delta = 10), 1, 'Une ligne au journal');
select is(public.lm_available_credits((select account_id from tcp)), 15, 'Disponible : 5 du forfait + 10 du pack');
select throws_ok($$ select public.lm_grant_credit_pack((select account_id from tcp), 'pack-s', 0, 'ord_x') $$, 'P0001', null,
  'Pack sans crédits refusé');

-- 2. Le forfait d'abord
select ok(public.lm_debit_credits((select account_id from tcp), 'discovery', 3, 'd1', 'kept'), 'Débit de 3');
select ok(pg_temp.bal() = 2 and pg_temp.left_in('ord_1') = 10, 'Pris sur le forfait, pack intact');

-- 3. Forfait épuisé : le reste sur le pack
select ok(public.lm_debit_credits((select account_id from tcp), 'discovery', 6, 'd2', 'kept'), 'Débit de 6');
select ok(pg_temp.bal() = 0 and pg_temp.left_in('ord_1') = 6, '2 sur le forfait, 4 sur le pack');

-- 4. Plusieurs packs : celui qui expire le plus tôt d'abord
select public.lm_grant_credit_pack((select account_id from tcp), 'pack-m', 20, 'ord_2');
set local role postgres;
update public.lm_credit_packs set expires_at = now() + interval '1 month' where order_ref = 'ord_2';
set local role service_role;
select ok(public.lm_debit_credits((select account_id from tcp), 'discovery', 5, 'd3', 'kept'), 'Débit de 5');
select ok(pg_temp.left_in('ord_2') = 15 and pg_temp.left_in('ord_1') = 6, 'Pris sur le pack qui expire le plus tôt');
select ok(public.lm_debit_credits((select account_id from tcp), 'discovery', 18, 'd4', 'kept'), 'Débit à cheval sur deux packs');
select ok(pg_temp.left_in('ord_2') = 0 and pg_temp.left_in('ord_1') = 3, '15 + 3');

-- 5. Pas assez : rien débité ; pack expiré : plus compté
select ok(not public.lm_debit_credits((select account_id from tcp), 'discovery', 4, 'd5', 'kept'), 'Solde insuffisant : refusé');
select is(pg_temp.left_in('ord_1'), 3, 'Rien de débité');
set local role postgres;
update public.lm_credit_packs set expires_at = now() - interval '1 day' where order_ref = 'ord_1';
set local role service_role;
select is(public.lm_available_credits((select account_id from tcp)), 0, 'Pack expiré : plus disponible');
select ok(not public.lm_debit_credits((select account_id from tcp), 'discovery', 1, 'd6', 'kept'), 'Pack expiré : pas de débit');

-- 6. Les campagnes voient les packs (lancement possible avec un forfait vide mais des packs)
select public.lm_grant_credit_pack((select account_id from tcp), 'pack-l', 30, 'ord_3');
set local role postgres;
select makerkit.authenticate_as('cp_owner');
select is(public.lm_available_credits((select account_id from tcp)), 30, 'Membre : voit ses crédits disponibles');
select is((select count(*)::integer from public.lm_credit_packs), 3, 'Membre : voit ses packs');
select throws_ok($$ select public.lm_grant_credit_pack((select account_id from tcp), 'pack-l', 30, 'evil') $$, '42501', null,
  'Client : ne s''ajoute pas de pack');
select throws_ok($$ insert into public.lm_credit_packs (account_id, pack_id, credits, remaining, order_ref)
                    values ((select account_id from tcp), 'pack-l', 99, 99, 'evil2') $$, '42501', null,
  'Client : n''écrit pas dans les packs');

select makerkit.authenticate_as('cp_other');
select is(public.lm_available_credits((select account_id from tcp)), null, 'Autre client : rien');
select is((select count(*)::integer from public.lm_credit_packs), 0, 'Autre client : aucun pack visible');

set local role anon;
select throws_ok($$ select public.lm_available_credits((select account_id from tcp)) $$, '42501', null, 'Anonyme : refusé');

select * from finish();

rollback;
