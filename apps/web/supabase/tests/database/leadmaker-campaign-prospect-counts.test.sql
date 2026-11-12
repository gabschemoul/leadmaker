-- Liste des campagnes (12/11/2026) : nombre de prospects par campagne, membres de l'organisation seulement.
begin;

select no_plan();

select tests.create_supabase_user('cpc_owner', 'cpc_owner@test.com');
select tests.create_supabase_user('cpc_other', 'cpc_other@test.com');

set local role service_role;
select public.create_team_account('Cpc A', tests.get_supabase_uid('cpc_owner'), 'cpc-a');
select public.create_team_account('Cpc B', tests.get_supabase_uid('cpc_other'), 'cpc-b');
set local role postgres;

insert into public.lm_campaigns (account_id, space_id, name, country_code)
select a.id, s.id, x.name, 'FR'
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default,
       (values ('Pleine'), ('Vide')) as x(name)
 where a.slug = 'cpc-a';

insert into public.lm_prospects (account_id, space_id, campaign_id, name, site_key, website)
select c.account_id, c.space_id, c.id, 'P' || g, 'p' || g || '.fr', 'https://p' || g || '.fr'
  from public.lm_campaigns c, generate_series(1, 3) g
 where c.name = 'Pleine';

create temp view acc as select id from public.accounts where slug = 'cpc-a';
grant select on acc to authenticated;

select makerkit.authenticate_as('cpc_owner');

select set_eq(
  $$ select c.name, x.prospects from public.lm_campaign_prospect_counts((select id from acc)) x
       join public.lm_campaigns c on c.id = x.campaign_id $$,
  $$ values ('Pleine', 3::bigint), ('Vide', 0::bigint) $$,
  'Une ligne par campagne, avec son nombre de prospects'
);

select makerkit.authenticate_as('cpc_other');

select is_empty($$ select * from public.lm_campaign_prospect_counts((select id from acc)) $$,
  'Rien pour une autre organisation');

set local role anon;
select throws_ok($$ select * from public.lm_campaign_prospect_counts((select id from acc)) $$, '42501',
  null, 'Interdit sans connexion');

select * from finish();

rollback;
