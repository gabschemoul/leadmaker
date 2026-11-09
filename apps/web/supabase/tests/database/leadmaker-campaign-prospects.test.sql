-- 9/11/2026 : lien campagne ↔ entreprise (CDC-PARCOURS-TRI-ANNUAIRE §7). Une entreprise peut appartenir à
-- plusieurs campagnes de son espace ; elle n'est payée qu'une fois par l'équipe ; elle est contactée au nom de
-- la campagne depuis laquelle on la prépare ; les liens restent privés à l'organisation.
begin;

select no_plan();

select tests.create_supabase_user('cp_owner', 'cp_owner@test.com');
select tests.create_supabase_user('cp_other', 'cp_other@test.com');

set local role service_role;
select public.create_team_account('Cp A', tests.get_supabase_uid('cp_owner'), 'cp-a');
select public.create_team_account('Cp B', tests.get_supabase_uid('cp_other'), 'cp-b');
set local role postgres;

create temp view tcp as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'cp-a';
create temp view tcp_b as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'cp-b';
grant select on tcp, tcp_b to authenticated, service_role;

insert into public.lm_account_credits (account_id, discovery_balance, outreach_balance)
select account_id, 100, 10 from tcp
on conflict (account_id) do update set discovery_balance = 100, outreach_balance = 10;

insert into public.lm_sender_profiles (account_id, space_id, first_name, last_name, company, email, country_code)
select account_id, space_id, 'Laurie', 'Test', 'Agence', 'l@test.com', 'FR' from tcp;

-- Deux campagnes du même espace (A à 2 crédits par prospect), une campagne d'une autre organisation
insert into public.lm_campaigns (id, account_id, space_id, name, country_code, templates, credits_per_prospect)
select 'c0000000-0000-4000-8000-0000000000a1'::uuid, account_id, space_id, 'Camp A', 'FR',
       '{"messages":[{"name":"MA","subject":"Objet","body":"Bonjour {company}, ici {my_company}"}]}'::jsonb, 2 from tcp
union all
select 'c0000000-0000-4000-8000-0000000000b1'::uuid, account_id, space_id, 'Camp B', 'FR',
       '{"messages":[{"name":"MB","subject":"Objet","body":"Salut {company}, ici {my_company}"}]}'::jsonb, 1 from tcp
union all
select 'c0000000-0000-4000-8000-0000000000c1'::uuid, account_id, space_id, 'Camp autre orga', 'FR', '{}'::jsonb, 1 from tcp_b;

set local role service_role;

-- 1. Prospect gardé par A : lien posé avec les crédits débités
select is(public.lm_record_prospect('c0000000-0000-4000-8000-0000000000a1',
            '{"place_id":"cp:1","name":"Agence Un","site_key":"un.fr","website":"https://un.fr"}'),
          'kept', 'Campagne A garde l''entreprise');
select is((select credits from public.lm_campaign_prospects
            where campaign_id = 'c0000000-0000-4000-8000-0000000000a1'
              and prospect_id = (select id from public.lm_prospects where site_key = 'un.fr')),
          2, 'Lien A posé avec les 2 crédits débités');
select is((select discovery_balance from public.lm_account_credits where account_id = (select account_id from tcp)),
          98, 'Solde débité une fois');

-- 2. La même entreprise retrouvée par B : liée à B aussi, sans nouveau débit
select is(public.lm_record_prospect('c0000000-0000-4000-8000-0000000000b1',
            '{"place_id":"cp:1","name":"Agence Un","site_key":"un.fr","website":"https://un.fr"}'),
          'duplicate', 'Campagne B la retrouve : déjà dans l''espace');
select is((select credits from public.lm_campaign_prospects
            where campaign_id = 'c0000000-0000-4000-8000-0000000000b1'
              and prospect_id = (select id from public.lm_prospects where site_key = 'un.fr')),
          0, 'Liée à B sans crédit');
select is((select discovery_balance from public.lm_account_credits where account_id = (select account_id from tcp)),
          98, 'Jamais payée deux fois par l''équipe');
select is((select count(*)::integer from public.lm_prospects where site_key = 'un.fr'), 1, 'Toujours une seule entreprise');
select is((select campaign_id from public.lm_prospects where site_key = 'un.fr'),
          'c0000000-0000-4000-8000-0000000000a1'::uuid, 'Campagne d''origine inchangée (code en ligne)');
select is(public.lm_record_prospect('c0000000-0000-4000-8000-0000000000b1',
            '{"place_id":"cp:1","name":"Agence Un","site_key":"un.fr","website":"https://un.fr"}'),
          'duplicate', 'Retrouvée une deuxième fois par B : sans erreur');
select is((select count(*)::integer from public.lm_campaign_prospects
            where prospect_id = (select id from public.lm_prospects where site_key = 'un.fr')),
          2, 'Toujours deux liens (A et B)');

-- 3. Plus de crédits : ni prospect ni lien
update public.lm_account_credits set discovery_balance = 0 where account_id = (select account_id from tcp);
select is(public.lm_record_prospect('c0000000-0000-4000-8000-0000000000b1',
            '{"place_id":"cp:2","name":"Agence Deux","site_key":"deux.fr","website":"https://deux.fr"}'),
          'no_credits', 'Sans crédit : refusé');
select is((select count(*)::integer from public.lm_campaign_prospects cp join public.lm_prospects p on p.id = cp.prospect_id
            where p.site_key = 'deux.fr'), 0, 'Sans crédit : aucun lien');
update public.lm_account_credits set discovery_balance = 100 where account_id = (select account_id from tcp);

-- 4. Un lien entre espaces ou organisations différents est refusé
select throws_ok($$
  insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id)
  select 'c0000000-0000-4000-8000-0000000000c1', p.id, p.account_id, p.space_id
    from public.lm_prospects p where p.site_key = 'un.fr' $$,
  '23514', null, 'Campagne d''une autre organisation : refusé');
select throws_ok($$
  insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id)
  select 'c0000000-0000-4000-8000-0000000000c1', p.id, t.account_id, t.space_id
    from public.lm_prospects p, tcp_b t where p.site_key = 'un.fr' $$,
  '23514', null, 'Entreprise d''une autre organisation : refusé');

-- 5. Préparée depuis B : contactée au nom de B (ses messages) ; sans lien vers la campagne demandée : origine
select makerkit.authenticate_as('cp_owner');
select is((select (queued, skipped)::text from public.lm_prepare_prospects(
            array[(select id from public.lm_prospects where site_key = 'un.fr')], 'c0000000-0000-4000-8000-0000000000b1')),
          '(1,0)', 'Préparée depuis B');
set local role postgres;
select is((select campaign_id from public.lm_attempts where prospect_id = (select id from public.lm_prospects where site_key = 'un.fr')),
          'c0000000-0000-4000-8000-0000000000b1'::uuid, 'Contactée au nom de B, la campagne liée demandée');
delete from public.lm_attempts where prospect_id = (select id from public.lm_prospects where site_key = 'un.fr');
delete from public.lm_campaign_prospects
 where campaign_id = 'c0000000-0000-4000-8000-0000000000b1'
   and prospect_id = (select id from public.lm_prospects where site_key = 'un.fr');
select makerkit.authenticate_as('cp_owner');
select is((select (queued, skipped)::text from public.lm_prepare_prospects(
            array[(select id from public.lm_prospects where site_key = 'un.fr')], 'c0000000-0000-4000-8000-0000000000b1')),
          '(1,0)', 'Préparée depuis B sans lien');
set local role postgres;
select is((select campaign_id from public.lm_attempts where prospect_id = (select id from public.lm_prospects where site_key = 'un.fr')),
          'c0000000-0000-4000-8000-0000000000a1'::uuid, 'Sans lien vers B : campagne d''origine, comme avant');

-- 6. Liens privés à l'organisation, en lecture seule
select makerkit.authenticate_as('cp_owner');
select is((select count(*)::integer from public.lm_campaign_prospects), 1, 'Le membre voit les liens de son organisation');
select throws_ok($$ update public.lm_campaign_prospects set credits = 0 $$, '42501', null, 'Client : modification interdite');
select throws_ok($$ delete from public.lm_campaign_prospects $$, '42501', null, 'Client : suppression interdite');
select throws_ok($$
  insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id)
  select 'c0000000-0000-4000-8000-0000000000b1', p.id, p.account_id, p.space_id from public.lm_prospects p limit 1 $$,
  '42501', null, 'Client : ajout interdit');

select makerkit.authenticate_as('cp_other');
select is((select count(*)::integer from public.lm_campaign_prospects), 0, 'Une autre organisation ne voit rien');

set local role anon;
select throws_ok('select count(*) from public.lm_campaign_prospects', '42501', null, 'Anonyme : illisible');

set local role postgres;
select ok(not has_table_privilege('authenticated', 'public.lm_campaign_prospects', 'TRUNCATE')
          and not has_table_privilege('anon', 'public.lm_campaign_prospects', 'TRUNCATE'),
  'Aucun TRUNCATE pour les clients');

-- 7. Campagne supprimée : ses liens partent, l'entreprise reste
delete from public.lm_campaigns where id = 'c0000000-0000-4000-8000-0000000000a1';
select is((select count(*)::integer from public.lm_campaign_prospects
            where prospect_id = (select id from public.lm_prospects where site_key = 'un.fr')), 0, 'Liens de la campagne supprimés');
select is((select count(*)::integer from public.lm_prospects where site_key = 'un.fr'), 1, 'L''entreprise reste');

select * from finish();

rollback;
