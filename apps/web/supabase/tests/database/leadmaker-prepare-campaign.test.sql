-- « Préparer les formulaires » d'une campagne (lm_prepare_campaign, 5/11/2026) : une campagne plus grosse que le
-- plafond de l'espace prépare exactement la place restante (les plus anciens d'abord) au lieu de tout annuler,
-- puis refuse clairement (cap_reached) quand le plafond est plein.
begin;

select no_plan();

select tests.create_supabase_user('pc_owner', 'pc_owner@test.com');
select tests.create_supabase_user('pc_other', 'pc_other@test.com');

set local role service_role;
select public.create_team_account('Pc A', tests.get_supabase_uid('pc_owner'), 'pc-a');
set local role postgres;

create temp view tpc as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'pc-a';
grant select on tpc to authenticated, service_role;

insert into public.lm_account_credits (account_id, outreach_balance)
values ((select account_id from tpc), 10)
on conflict (account_id) do update set outreach_balance = 10;

insert into public.lm_sender_profiles (account_id, space_id, first_name, last_name, company, email, country_code)
select account_id, space_id, 'Laurie', 'Test', 'Agence', 'l@test.com', 'FR' from tpc;

insert into public.lm_campaigns (id, account_id, space_id, name, country_code, templates)
select 'a0000000-0000-4000-8000-0000000c0001', account_id, space_id, 'Grosse', 'FR',
       '{"messages":[{"name":"M1","subject":"Objet","body":"Bonjour {company}, ici {my_company}"}]}'::jsonb from tpc;

-- 5 prospects avec site, créés dans l'ordre P1 → P5 ; plafond de l'espace : 3
-- (le déclencheur des dates remplacerait created_at par l'heure du moment : les 5 auraient la même date et
-- l'ordre « les plus anciens d'abord » deviendrait aléatoire)
alter table public.lm_prospects disable trigger lm_prospects_set_timestamps;
insert into public.lm_prospects (account_id, space_id, campaign_id, name, site_key, website, created_at)
select t.account_id, t.space_id, 'a0000000-0000-4000-8000-0000000c0001', 'P' || i, 'p' || i || '.fr',
       'https://p' || i || '.fr', now() - make_interval(mins => 10 - i)
  from tpc t, generate_series(1, 5) i;
alter table public.lm_prospects enable trigger lm_prospects_set_timestamps;
update public.lm_spaces set ready_forms_cap = 3 where id = (select space_id from tpc);

select makerkit.authenticate_as('pc_owner');

select is((select (queued, skipped)::text from public.lm_prepare_campaign('a0000000-0000-4000-8000-0000000c0001')),
  '(3,0)', 'Campagne plus grosse que le plafond : la place restante est préparée, rien n''est annulé');

set local role postgres;
select is((select string_agg(p.name, ',' order by p.name) from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id
            where a.campaign_id = 'a0000000-0000-4000-8000-0000000c0001'),
  'P1,P2,P3', 'Les plus anciens d''abord');
select makerkit.authenticate_as('pc_owner');

select throws_ok($$ select * from public.lm_prepare_campaign('a0000000-0000-4000-8000-0000000c0001') $$,
  'P0001', null, 'Plafond plein : refus clair');

-- Place libérée (une validée) : le clic suivant prend le prospect suivant
set local role postgres;
update public.lm_attempts set status = 'validated'
 where prospect_id = (select id from public.lm_prospects where name = 'P1' and campaign_id = 'a0000000-0000-4000-8000-0000000c0001');
select makerkit.authenticate_as('pc_owner');
select is((select (queued, skipped)::text from public.lm_prepare_campaign('a0000000-0000-4000-8000-0000000c0001')),
  '(1,0)', 'Une place libérée : un prospect de plus');
set local role postgres;
select ok(exists (select 1 from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id
                   where p.name = 'P4' and a.campaign_id = 'a0000000-0000-4000-8000-0000000c0001'), 'C''est bien P4 (le suivant)');

-- Un non-membre ne prépare rien
select makerkit.authenticate_as('pc_other');
select is((select (queued, skipped)::text from public.lm_prepare_campaign('a0000000-0000-4000-8000-0000000c0001')),
  '(0,0)', 'Un autre utilisateur ne prépare rien');

select * from finish();

rollback;
