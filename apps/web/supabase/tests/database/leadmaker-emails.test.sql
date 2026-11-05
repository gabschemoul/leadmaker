-- Lot 2 : recherche d'e-mails sur le site (lm_find_emails, lm_finish_emails).
begin;

select no_plan();

select tests.create_supabase_user('em_owner', 'em_owner@test.com');
select tests.create_supabase_user('em_other', 'em_other@test.com');

set local role service_role;
select public.create_team_account('Em A', tests.get_supabase_uid('em_owner'), 'em-a');
select public.create_team_account('Em B', tests.get_supabase_uid('em_other'), 'em-b');
set local role postgres;

create temp view ta as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'em-a';
grant select on ta to authenticated, service_role;

-- Les robots exigent un forfait (audit 5/11/2026, A9)
set local role service_role;
select public.lm_reset_credits((select id from public.accounts where slug = 'em-a'), 'growth', now() + interval '30 days', 'test:em-a:plan');
set local role postgres;

select makerkit.authenticate_as('em_owner');

set local role postgres;
insert into public.lm_prospects (account_id, space_id, name, site_key, website, found_email, excluded_at)
select t.account_id, t.space_id, x.name, x.key, x.site, x.email, x.excl
  from ta t,
       (values ('Un', 'un.fr', 'https://un.fr', null, null::timestamptz),
               ('Deja', 'deja.fr', 'https://deja.fr', 'hello@deja.fr', null),
               ('SansSite', 'maps:0x1', null, null, null),
               ('Exclu', 'exclu.fr', 'https://exclu.fr', null, now())) as x(name, key, site, email, excl);
select makerkit.authenticate_as('em_owner');

-- Un seul prospect cherchable : site web, pas d'e-mail, pas exclu
select is((select (queued, skipped)::text from public.lm_find_emails(array(select id from public.lm_prospects))),
  '(1,3)', 'Une recherche lancée, trois prospects passés');
select is((select count(*)::int from public.lm_tasks where kind = 'emails'), 1, 'Une tâche emails');
select is((select payload ->> 'prospect_id' from public.lm_tasks where kind = 'emails'),
  (select id::text from public.lm_prospects where name = 'Un'), 'La tâche vise le bon prospect');

-- Déjà en file : pas de doublon
select is((select (queued, skipped)::text from public.lm_find_emails(array(select id from public.lm_prospects where name = 'Un'))),
  '(0,1)', 'Pas de seconde tâche tant que la première est en file');

-- Un membre d'une autre organisation ne peut rien lancer sur ces prospects
select makerkit.authenticate_as('em_other');
select is((select (queued, skipped)::text from public.lm_find_emails(array(select id from public.lm_prospects where name = 'Un'))),
  '(0,0)', 'Les prospects d''une autre organisation sont invisibles');
select is((select count(*)::int from public.lm_tasks where kind = 'emails'), 0, 'Aucune tâche visible pour l''autre organisation');

-- Le résultat n'est enregistrable que par le worker
select makerkit.authenticate_as('em_owner');
select throws_ok(
  $$ select public.lm_finish_emails((select id from public.lm_prospects where name = 'Un'), 'x@un.fr') $$,
  '42501', null, 'lm_finish_emails interdit aux membres');

set local role service_role;
select is(public.lm_finish_emails((select id from public.lm_prospects where name = 'Un'), '  Contact@Un.fr '), true, 'Résultat enregistré');
select is(public.lm_finish_emails((select id from public.lm_prospects where name = 'Deja'), null), true, 'Recherche sans résultat enregistrée');
set local role postgres;

select makerkit.authenticate_as('em_owner');
select is((select found_email from public.lm_prospects where name = 'Un'), 'Contact@Un.fr', 'E-mail trouvé enregistré (espaces retirés)');
select isnt((select email_checked_at from public.lm_prospects where name = 'Un'), null, 'Date de recherche posée');
select is((select found_email from public.lm_prospects where name = 'Deja'), 'hello@deja.fr', 'Un résultat vide ne supprime pas l''e-mail existant');
select isnt((select email_checked_at from public.lm_prospects where name = 'Deja'), null, 'Date de recherche posée même sans résultat');

-- Une fois l'e-mail trouvé, plus rien à chercher
select is((select (queued, skipped)::text from public.lm_find_emails(array(select id from public.lm_prospects))),
  '(0,4)', 'Plus rien à chercher');

select * from finish();

rollback;
