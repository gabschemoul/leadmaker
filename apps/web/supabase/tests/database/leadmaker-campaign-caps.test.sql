-- 11/11/2026 : plafonds d'une campagne (maximum de prospects gardés, maximum de crédits) : au-delà, plus rien n'est
-- payé et la campagne se met en pause « cap_reached » ; la reprise est refusée tant que le plafond n'est pas monté.
begin;

select no_plan();

select tests.create_supabase_user('cap_owner', 'cap_owner@test.com');
select tests.create_supabase_user('cap_other', 'cap_other@test.com');

set local role service_role;
select public.create_team_account('Cap A', tests.get_supabase_uid('cap_owner'), 'cap-a');
select public.create_team_account('Cap B', tests.get_supabase_uid('cap_other'), 'cap-b');
set local role postgres;

create temp view tcap as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'cap-a';
grant select on tcap to authenticated, service_role;

insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
insert into public.lm_account_credits (account_id, plan_id, discovery_balance) select account_id, 'growth', 100 from tcap
on conflict (account_id) do update set plan_id = 'growth', discovery_balance = 100;

insert into public.lm_campaigns (id, account_id, space_id, name, country_code, status)
select x.id, t.account_id, t.space_id, x.name, 'FR', 'running'
  from tcap t, (values ('ec000000-0000-4000-8000-0000000000a1'::uuid, 'Max gardés'),
                       ('ec000000-0000-4000-8000-0000000000b1'::uuid, 'Max crédits')) x(id, name);

create function pg_temp.pid(p_key text) returns uuid language sql as $$
  select id from public.lm_prospects where site_key = p_key $$;
create function pg_temp.bal() returns integer language sql as $$
  select discovery_balance from public.lm_account_credits where account_id = (select account_id from tcap) $$;
grant execute on function pg_temp.pid(text), pg_temp.bal() to service_role, authenticated;

-- le client fixe les plafonds ; une autre organisation ne peut pas
select makerkit.authenticate_as('cap_owner');
select lives_ok($$ select public.lm_set_campaign_caps('ec000000-0000-4000-8000-0000000000a1', 2, null) $$,
  'Le membre fixe un maximum de 2 prospects gardés');
select lives_ok($$ select public.lm_set_campaign_caps('ec000000-0000-4000-8000-0000000000b1', null, 3) $$,
  'Le membre fixe un budget de 3 crédits');
select throws_ok($$ select public.lm_set_campaign_caps('ec000000-0000-4000-8000-0000000000a1', 0, null) $$,
  'P0001', 'invalid cap', 'Plafond à 0 refusé');
select makerkit.authenticate_as('cap_other');
select throws_ok($$ select public.lm_set_campaign_caps('ec000000-0000-4000-8000-0000000000a1', 1000, null) $$,
  'P0002', 'campaign not found', 'Une autre organisation ne peut pas toucher aux plafonds');
set local role postgres;

-- max 2 gardés : le 3e n'est pas payé, la campagne se met en pause
set local role service_role;
select public.lm_start_sort('ec000000-0000-4000-8000-0000000000a1', 'Agences');
select public.lm_record_prospect('ec000000-0000-4000-8000-0000000000a1',
  format('{"place_id":"cap:%s","name":"E %s","site_key":"%s.fr","website":"https://%s.fr"}', n, n, n, n)::jsonb)
  from unnest(array['a1', 'a2', 'a3']) n;
select public.lm_finish_sort('ec000000-0000-4000-8000-0000000000a1', pg_temp.pid(n || '.fr'), 1, 'gardee', null, 'ok')
  from unnest(array['a1', 'a2', 'a3']) n;
select is((select count(*)::int from public.lm_campaign_prospects
            where campaign_id = 'ec000000-0000-4000-8000-0000000000a1' and paid_at is not null), 2,
  '2 gardés payés, pas le 3e');
select is((select status::text || ' / ' || (filters ->> 'paused_reason') from public.lm_campaigns
            where id = 'ec000000-0000-4000-8000-0000000000a1'), 'paused / cap_reached', 'Campagne en pause « plafond atteint »');
set local role postgres;
select makerkit.authenticate_as('cap_owner');
select throws_ok($$ select public.lm_start_campaign('ec000000-0000-4000-8000-0000000000a1') $$,
  'P0001', 'campaign cap reached', 'Reprise refusée tant que le plafond n''est pas monté');

-- budget 3 crédits (1 crédit par gardé pendant la mesure) : 3 payés, le 4e non
set local role service_role;
select public.lm_start_sort('ec000000-0000-4000-8000-0000000000b1', 'Agences');
select public.lm_record_prospect('ec000000-0000-4000-8000-0000000000b1',
  format('{"place_id":"cap:%s","name":"E %s","site_key":"%s.fr","website":"https://%s.fr"}', n, n, n, n)::jsonb)
  from unnest(array['b1', 'b2', 'b3', 'b4']) n;
select public.lm_finish_sort('ec000000-0000-4000-8000-0000000000b1', pg_temp.pid(n || '.fr'), 1, 'gardee', null, 'ok')
  from unnest(array['b1', 'b2', 'b3', 'b4']) n;
select is((select coalesce(sum(credits), 0)::int from public.lm_campaign_prospects
            where campaign_id = 'ec000000-0000-4000-8000-0000000000b1' and paid_at is not null), 3,
  'Budget de 3 crédits respecté');
select is((select filters ->> 'paused_reason' from public.lm_campaigns where id = 'ec000000-0000-4000-8000-0000000000b1'),
  'cap_reached', 'Budget atteint : pause « plafond atteint »');

select * from finish();

rollback;
