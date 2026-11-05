-- Lot 2 : actions groupées sur les prospects (exclure, rétablir, supprimer) et liste d'opposition.
begin;

select no_plan();

select tests.create_supabase_user('pro_owner', 'pro_owner@test.com');
select tests.create_supabase_user('pro_member', 'pro_member@test.com');
select tests.create_supabase_user('pro_other', 'pro_other@test.com');

set local role service_role;
select public.create_team_account('Pro A', tests.get_supabase_uid('pro_owner'), 'pro-a');
select public.create_team_account('Pro B', tests.get_supabase_uid('pro_other'), 'pro-b');
insert into public.accounts_memberships (user_id, account_id, account_role)
values (tests.get_supabase_uid('pro_member'), (select id from public.accounts where slug = 'pro-a'), 'member');
insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
set local role postgres;

select makerkit.authenticate_as('pro_owner');

set local role postgres;
insert into public.lm_prospects (account_id, space_id, name, site_key, website, category, city)
select a.id, s.id, x.name, x.key, 'https://' || x.key, 'Plumber', 'Lyon'
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default,
       (values ('Un', 'un.fr'), ('Deux', 'deux.fr'), ('Trois', 'maps:0xabc')) as x(name, key)
 where a.slug = 'pro-a';
select makerkit.authenticate_as('pro_owner');

select is((select (kind, value, total)::text from public.lm_prospect_facets((select s.id from public.lm_spaces s join public.accounts a on a.id = s.account_id where a.slug = 'pro-a' and s.is_default)) where kind = 'city'),
  '(city,Lyon,3)', 'Les filtres listent les villes présentes');

-- Exclusion par un simple membre : prospects exclus, sites en liste d'opposition (pas les clés maps:)
select makerkit.authenticate_as('pro_member');
select is(public.lm_exclude_prospects(array(select id from public.lm_prospects where name in ('Un', 'Trois'))), 2, 'Un membre exclut deux prospects');
select is((select count(*)::int from public.lm_prospects where excluded_at is not null), 2, 'Les deux prospects sont marqués exclus');
select is((select count(*)::int from public.lm_suppressions where reason = 'excluded'), 1, 'Seul le site réel rejoint la liste d''opposition');

-- Le scan ne reprend pas un site en liste d'opposition
set local role service_role;
select is(public.lm_site_known((select s.id from public.lm_spaces s join public.accounts a on a.id = s.account_id where a.slug = 'pro-a' and s.is_default), 'un.fr'), true, 'Site exclu : connu du scan');
select is(public.lm_site_known((select s.id from public.lm_spaces s join public.accounts a on a.id = s.account_id where a.slug = 'pro-a' and s.is_default), 'inconnu.fr'), false, 'Site inconnu : libre');
set local role postgres;

-- Rétablissement
select makerkit.authenticate_as('pro_member');
select is(public.lm_restore_prospects(array(select id from public.lm_prospects where name = 'Un')), 1, 'Un prospect rétabli');
select is((select count(*)::int from public.lm_suppressions where site_key = 'un.fr'), 0, 'Son site quitte la liste d''opposition');

-- Suppression : permission settings.manage (que le kit accorde aux membres et aux propriétaires)
select is(public.lm_delete_prospects(array(select id from public.lm_prospects where name = 'Deux')), 1, 'Un membre supprime');
select makerkit.authenticate_as('pro_owner');
select is(public.lm_delete_prospects(array(select id from public.lm_prospects where name = 'Trois')), 1, 'Le propriétaire supprime');
select is((select count(*)::int from public.lm_prospects), 1, 'Il ne reste qu''un prospect');

-- Une autre organisation ne touche à rien
select makerkit.authenticate_as('pro_other');
select is(public.lm_exclude_prospects(array(select p.id from public.lm_prospects p join public.accounts a on a.id = p.account_id where a.slug = 'pro-a')), 0, 'B n''exclut rien chez A');
select is(public.lm_delete_prospects(array(select p.id from public.lm_prospects p join public.accounts a on a.id = p.account_id where a.slug = 'pro-a')), 0, 'B ne supprime rien chez A');
select is((select count(*)::int from public.lm_prospect_facets((select s.id from public.lm_spaces s join public.accounts a on a.id = s.account_id where a.slug = 'pro-a' and s.is_default))), 0, 'B ne voit pas les filtres de A');

select * from finish();

rollback;
