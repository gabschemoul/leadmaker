-- 10/11/2026 : consommation des crédits (lm_credit_usage, carte « Vos crédits » de la page Facturation) passée en
-- security definer pour la vitesse. Elle ne doit renvoyer que la consommation d'une organisation dont on est
-- membre, avec les bons totaux par jour et par campagne, et rien pour un anonyme.
begin;

select no_plan();

select tests.create_supabase_user('cu_a', 'cu_a@test.com');
select tests.create_supabase_user('cu_b', 'cu_b@test.com');

set local role service_role;
select public.create_team_account('Cu A', tests.get_supabase_uid('cu_a'), 'cu-a');
select public.create_team_account('Cu B', tests.get_supabase_uid('cu_b'), 'cu-b');
set local role postgres;

create temp table t_cu as
select (select id from public.accounts where slug = 'cu-a') as acc_a,
       (select id from public.accounts where slug = 'cu-b') as acc_b,
       (select s.id from public.lm_spaces s join public.accounts a on a.id = s.account_id where a.slug = 'cu-a' and s.is_default) as space_a;
grant select on t_cu to authenticated, service_role, anon;

insert into public.lm_campaigns (account_id, space_id, name, country_code)
select acc_a, space_a, 'Campagne A', 'FR' from t_cu;

insert into public.lm_credit_ledger (account_id, kind, delta, reason, campaign_id, event_ref)
select acc_a, 'discovery'::public.lm_credit_kind, -1, 'place', (select id from public.lm_campaigns where name = 'Campagne A'), 'cu-1' from t_cu
union all select acc_a, 'discovery'::public.lm_credit_kind, -1, 'place', (select id from public.lm_campaigns where name = 'Campagne A'), 'cu-2' from t_cu
union all select acc_a, 'discovery'::public.lm_credit_kind, 500, 'refill', null, 'cu-3' from t_cu
union all select acc_b, 'discovery'::public.lm_credit_kind, -7, 'place', null, 'cu-4' from t_cu;

-- membre : ses totaux, nom de campagne compris
select makerkit.authenticate_as('cu_a');
select is((select used from public.lm_credit_usage((select acc_a from t_cu), 30) where campaign_name = 'Campagne A'), 2,
  'Débits additionnés par jour et par campagne');
select is((select added from public.lm_credit_usage((select acc_a from t_cu), 30) where campaign_id is null), 500,
  'Recharge à part (sans campagne)');

-- autre organisation : rien, même en visant directement son identifiant
select is((select count(*)::integer from public.lm_credit_usage((select acc_b from t_cu), 30)), 0,
  'A ne voit rien de B');

select makerkit.authenticate_as('cu_b');
select is((select count(*)::integer from public.lm_credit_usage((select acc_a from t_cu), 30)), 0,
  'B ne voit rien de A');
select is((select used from public.lm_credit_usage((select acc_b from t_cu), 30)), 7,
  'B voit sa consommation');

-- anonyme : refusé
set local role anon;
select throws_ok($$ select * from public.lm_credit_usage((select acc_a from t_cu), 30) $$, '42501', null,
  'Anonyme : refusé');

select * from finish();

rollback;
