-- 10/11/2026 : recherche de la page Prospects par une fonction security definer (lm_search_prospects), pour que
-- les index trigrammes servent malgré la RLS. Elle ne doit renvoyer que les fiches d'un dossier dont on est
-- membre, échapper les jokers LIKE, et rien pour un anonyme.
begin;

select no_plan();

select tests.create_supabase_user('ps_a', 'ps_a@test.com');
select tests.create_supabase_user('ps_b', 'ps_b@test.com');

set local role service_role;
select public.create_team_account('Ps A', tests.get_supabase_uid('ps_a'), 'ps-a');
select public.create_team_account('Ps B', tests.get_supabase_uid('ps_b'), 'ps-b');
set local role postgres;

create temp table t_ps as
select (select id from public.accounts where slug = 'ps-a') as acc_a,
       (select s.id from public.lm_spaces s join public.accounts a on a.id = s.account_id where a.slug = 'ps-a' and s.is_default) as space_a,
       (select id from public.accounts where slug = 'ps-b') as acc_b,
       (select s.id from public.lm_spaces s join public.accounts a on a.id = s.account_id where a.slug = 'ps-b' and s.is_default) as space_b;
grant select on t_ps to authenticated, service_role, anon;

insert into public.lm_prospects (account_id, space_id, name, site_key, address, phone)
select acc_a, space_a, 'Menuiserie Dupont', 'dupont.example', '1 rue du Bois, Lyon', '0102030405' from t_ps
union all select acc_a, space_a, 'Plomberie Martin', 'martin.example', '2 rue de l''Eau', '0607080910' from t_ps
union all select acc_a, space_a, 'Remise 100% bois', 'cent.example', null, null from t_ps
union all select acc_b, space_b, 'Menuiserie Secrète', 'secret.example', 'Ailleurs', null from t_ps;

-- membre : ses fiches, sur chaque colonne
select makerkit.authenticate_as('ps_a');
select is((select count(*)::integer from public.lm_search_prospects((select space_a from t_ps), 'menuis')), 1,
  'Recherche sur le nom (sans tenir compte des majuscules)');
select is((select count(*)::integer from public.lm_search_prospects((select space_a from t_ps), 'rue de l''eau')), 1,
  'Recherche sur l''adresse');
select is((select count(*)::integer from public.lm_search_prospects((select space_a from t_ps), 'martin.exa')), 1,
  'Recherche sur le site');
select is((select count(*)::integer from public.lm_search_prospects((select space_a from t_ps), '0607')), 1,
  'Recherche sur le téléphone');
select is((select count(*)::integer from public.lm_search_prospects((select space_a from t_ps), '   ')), 0,
  'Texte vide : rien');

-- jokers échappés : « % » ne veut pas dire « n'importe quoi »
select is((select count(*)::integer from public.lm_search_prospects((select space_a from t_ps), '%')), 1,
  '« % » cherché tel quel');
select is((select count(*)::integer from public.lm_search_prospects((select space_a from t_ps), '_')), 0,
  '« _ » cherché tel quel');

-- l'appli ajoute ses filtres par-dessus (comme PostgREST)
select is((select count(*)::integer from public.lm_search_prospects((select space_a from t_ps), 'e')
           where excluded_at is null), 3, 'Filtres supplémentaires sur le résultat');

-- autre organisation : rien, même en visant directement son dossier
select is((select count(*)::integer from public.lm_search_prospects((select space_b from t_ps), 'menuis')), 0,
  'Dossier d''une autre organisation : aucune fiche');

select makerkit.authenticate_as('ps_b');
select is((select count(*)::integer from public.lm_search_prospects((select space_a from t_ps), 'e')), 0,
  'B ne voit pas les fiches de A');
select is((select count(*)::integer from public.lm_search_prospects((select space_b from t_ps), 'menuis')), 1,
  'B voit les siennes');

-- anonyme : refusé
set local role anon;
select throws_ok($$ select * from public.lm_search_prospects((select space_a from t_ps), 'menuis') $$, '42501', null,
  'Anonyme : refusé');

select * from finish();

rollback;
