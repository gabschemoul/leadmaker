-- Lot 2 : préparation des formulaires (lm_prepare_prospects, lm_finish_prepare) et validation.
begin;

select no_plan();

select tests.create_supabase_user('out_owner', 'out_owner@test.com');
select tests.create_supabase_user('out_other', 'out_other@test.com');

set local role service_role;
select public.create_team_account('Out A', tests.get_supabase_uid('out_owner'), 'out-a');
select public.create_team_account('Out B', tests.get_supabase_uid('out_other'), 'out-b');
set local role postgres;

create temp view ta as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'out-a';
grant select on ta to authenticated, service_role;

select makerkit.authenticate_as('out_owner');

insert into public.lm_campaigns (account_id, space_id, name, country_code, templates)
select account_id, space_id, 'Camp', 'FR', '{"messages":[{"name":"M1","subject":"Objet","body":"Bonjour {company}, ici {my_company}"}],"short":{"subject":"","body":""}}'::jsonb from ta;

insert into public.lm_prospects (account_id, space_id, campaign_id, name, site_key, website, excluded_at)
select t.account_id, t.space_id, c.id, x.name, x.key, x.site, x.excl
  from ta t, public.lm_campaigns c,
       (values ('Un', 'un.fr', 'https://un.fr', null::timestamptz),
               ('Deux', 'deux.fr', 'https://deux.fr', null),
               ('SansSite', 'maps:0x1', null, null),
               ('Exclu', 'exclu.fr', 'https://exclu.fr', now())) as x(name, key, site, excl)
 where c.name = 'Camp';

-- Sans profil expéditeur : refus clair
select throws_ok(
  $$ select * from public.lm_prepare_prospects(array(select id from public.lm_prospects where name = 'Un')) $$,
  'P0001', null, 'Préparation refusée sans profil expéditeur');

insert into public.lm_sender_profiles (account_id, space_id, first_name, last_name, company, email, country_code)
select account_id, space_id, 'Laurie', 'Test', 'Agence', 'l@test.com', 'FR' from ta;

-- Sans message dans la campagne : refus
update public.lm_campaigns set templates = '[]'::jsonb;
select throws_ok(
  $$ select * from public.lm_prepare_prospects(array(select id from public.lm_prospects where name = 'Un')) $$,
  'P0001', null, 'Préparation refusée sans message');
update public.lm_campaigns set templates = '{"messages":[{"name":"M1","subject":"Objet","body":"Bonjour {company}, ici {my_company}"}]}'::jsonb;

-- Préparation de tout : 2 en file (site web, non exclus), 2 passés
select is((select (queued, skipped)::text from public.lm_prepare_prospects(array(select id from public.lm_prospects))),
  '(2,2)', 'Deux prospects préparables, deux passés');
select is((select count(*)::int from public.lm_attempts where status = 'pending'), 2, 'Deux tentatives en attente');
select is((select count(*)::int from public.lm_tasks where kind = 'prepare'), 2, 'Deux tâches de préparation');

-- Une seconde demande ne crée rien (tentatives déjà en attente)
select is((select (queued, skipped)::text from public.lm_prepare_prospects(array(select id from public.lm_prospects))),
  '(0,4)', 'Rien à refaire tant que la préparation est en cours');

-- Le worker termine : prêt pour Un, à compléter pour Deux
set local role service_role;
select is(public.lm_finish_prepare((select a.id from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id where p.name = 'Un'),
  '{"status":"ready","template_name":"M1","subject":"Objet","body":"Bonjour Un, ici Agence","form_url":"https://un.fr/contact","filled":{"email":"Email"},"found_email":"hello@un.fr"}'::jsonb),
  true, 'Résultat enregistré pour Un');
select is(public.lm_finish_prepare((select a.id from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id where p.name = 'Deux'),
  '{"status":"incomplete","template_name":"M1","subject":"Objet","body":"Bonjour Deux, ici Agence","missing":["Numéro de SIRET"]}'::jsonb),
  true, 'Résultat enregistré pour Deux');
set local role postgres;

select makerkit.authenticate_as('out_owner');
select is((select found_email from public.lm_prospects where name = 'Un'), 'hello@un.fr', 'Email relevé enregistré sur le prospect');
select is((select (status, total)::text from public.lm_attempt_counts((select space_id from ta)) where status = 'ready'), '(ready,1)', 'Compteur par statut');

-- Validation : Un passe, Deux (champ manquant non renseigné) reste
select is(public.lm_validate_attempts(array(select id from public.lm_attempts)), 1, 'Seul le formulaire prêt est validé');
select is((select status::text from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id where p.name = 'Deux'), 'incomplete', 'Deux reste à compléter');

-- Deux complété puis validé
select is(public.lm_update_attempt((select a.id from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id where p.name = 'Deux'),
  'Objet', 'Bonjour Deux, ici Agence', '{"Numéro de SIRET":"123"}'::jsonb), true, 'Champ manquant renseigné');
select is(public.lm_validate_attempts(array(select id from public.lm_attempts)), 1, 'Deux validé une fois complété');
select is((select validated_by from public.lm_attempts limit 1), tests.get_supabase_uid('out_owner'), 'Le validateur est enregistré');

-- Une tentative validée n'est jamais réécrite par le worker ni reprise par la préparation
set local role service_role;
select is(public.lm_finish_prepare((select id from public.lm_attempts limit 1), '{"status":"no_form"}'::jsonb), false, 'Le worker n''écrase pas une tentative validée');
set local role postgres;
select makerkit.authenticate_as('out_owner');
select is((select (queued, skipped)::text from public.lm_prepare_prospects(array(select id from public.lm_prospects where name = 'Un'))), '(0,1)', 'Pas de nouvelle préparation d''une tentative validée');

-- Exclusion depuis une tentative : prospect en liste d'opposition
select is(public.lm_exclude_attempts(array(select a.id from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id where p.name = 'Un')), 1, 'Tentative exclue');
select is((select count(*)::int from public.lm_suppressions where site_key = 'un.fr'), 1, 'Site en liste d''opposition');

-- Plafond de l'espace
update public.lm_spaces set ready_forms_cap = 1 where id = (select space_id from ta);
insert into public.lm_prospects (account_id, space_id, campaign_id, name, site_key, website)
select t.account_id, t.space_id, c.id, 'Trois', 'trois.fr', 'https://trois.fr' from ta t, public.lm_campaigns c;
set local role postgres;
update public.lm_attempts set status = 'ready' where status = 'validated';
select makerkit.authenticate_as('out_owner');
select throws_ok(
  $$ select * from public.lm_prepare_prospects(array(select id from public.lm_prospects where name = 'Trois')) $$,
  'P0001', null, 'Plafond de formulaires prêts atteint');

-- Une autre organisation ne touche à rien
select makerkit.authenticate_as('out_other');
select is((select (queued, skipped)::text from public.lm_prepare_prospects(array(select id from public.lm_prospects))), '(0,0)', 'B ne prépare rien chez A');
select is(public.lm_validate_attempts(array(select id from public.lm_attempts)), 0, 'B ne valide rien chez A');
select is(public.lm_skip_attempts(array(select id from public.lm_attempts)), 0, 'B ne passe rien chez A');
select is((select count(*)::int from public.lm_attempt_counts((select space_id from ta))), 0, 'B ne voit pas les compteurs de A');
select throws_ok($$ select public.lm_finish_prepare('00000000-0000-0000-0000-000000000000', '{}'::jsonb) $$, '42501', null, 'lm_finish_prepare réservé au rôle service');

select * from finish();

rollback;
