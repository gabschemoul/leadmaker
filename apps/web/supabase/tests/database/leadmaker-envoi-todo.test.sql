-- Étape Envoi en un seul écran (12/11/2026) : listes « À vous de jouer » (à vérifier, site protégé, case inconnue),
-- « Envoyer » qui garde le formulaire dans son pilote, « C'est envoyé » pour un site protégé, isolation.
begin;

select no_plan();

select tests.create_supabase_user('todo_owner', 'todo_owner@test.com');
select tests.create_supabase_user('todo_other', 'todo_other@test.com');

set local role service_role;
select public.create_team_account('Todo A', tests.get_supabase_uid('todo_owner'), 'todo-a');
select public.create_team_account('Todo B', tests.get_supabase_uid('todo_other'), 'todo-b');
set local role postgres;

create temp view ta as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'todo-a';
grant select on ta to authenticated, service_role;

insert into public.lm_campaigns (account_id, space_id, name, country_code, templates)
select account_id, space_id, x.name, 'FR', '{"messages":[{"name":"M1","subject":"Objet","body":"Bonjour"}]}'::jsonb
  from ta, (values ('Camp'), ('Archivee')) as x(name);

create temp view camp as select id from public.lm_campaigns where name = 'Camp';
grant select on camp to authenticated, service_role;

-- Pilote en pause de la campagne
insert into public.lm_autopilots (account_id, space_id, campaign_id, status, target, messages)
select account_id, space_id, (select id from camp), 'paused', 50, array['M1'] from ta;

-- Une tentative par cas : (nom, statut, détail, protection, champs manquants, dans le pilote ?)
insert into public.lm_prospects (account_id, space_id, campaign_id, name, site_key, website)
select t.account_id, t.space_id, (select id from camp), x.name, x.name || '.fr', 'https://' || x.name || '.fr'
  from ta t, (values ('propre'), ('doute'), ('manuel'), ('captcha'), ('case'), ('envoye'), ('archive')) as x(name);

insert into public.lm_attempts (account_id, space_id, campaign_id, prospect_id, status, detail, protection_type, missing, autopilot_id)
select p.account_id, p.space_id,
       case when p.name = 'archive' then (select id from public.lm_campaigns where name = 'Archivee') else p.campaign_id end,
       p.id, x.status::public.lm_attempt_status, x.detail, x.protection, x.missing::jsonb,
       case when x.in_pilot then (select id from public.lm_autopilots) end
  from public.lm_prospects p
  join (values
    ('propre',  'ready',                 null,                        null,        '[]',          true),
    ('doute',   'ready',                 'page inattendue',           null,        '[]',          true),
    ('manuel',  'ready',                 null,                        null,        '[]',          false),
    ('captcha', 'intervention_required', null,                        'recaptcha', '[]',          true),
    ('case',    'incomplete',            null,                        null,        '["Calcul"]',  true),
    ('envoye',  'sent',                  null,                        null,        '[]',          true),
    ('archive', 'ready',                 'page inattendue',           null,        '[]',          false)
  ) as x(name, status, detail, protection, missing, in_pilot) on x.name = p.name;

update public.lm_campaigns set status = 'archived' where name = 'Archivee';

create function pg_temp.att(p_name text) returns uuid language sql as $$
  select a.id from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id where p.name = p_name
$$;
grant execute on function pg_temp.att(text) to authenticated, service_role;

select makerkit.authenticate_as('todo_owner');

select results_eq(
  $$ select to_check, captcha, unknown_field from public.lm_campaign_todo((select id from camp)) $$,
  $$ values (2, 1, 1) $$,
  'À vérifier : le douteux et le prêt hors pilote (pas le prêt sans doute du pilote en pause) ; 1 site protégé ; 1 case'
);

select set_eq(
  $$ select public.lm_campaign_todo_ids((select id from camp), 'to_check') $$,
  $$ values (pg_temp.att('doute')), (pg_temp.att('manuel')) $$,
  'Liste « à vérifier »'
);
select set_eq($$ select public.lm_campaign_todo_ids((select id from camp), 'captcha') $$,
  $$ values (pg_temp.att('captcha')) $$, 'Liste « site protégé »');
select set_eq($$ select public.lm_campaign_todo_ids((select id from camp), 'unknown_field') $$,
  $$ values (pg_temp.att('case')) $$, 'Liste « case inconnue »');

-- Une autre organisation ne voit rien et ne peut rien faire
select makerkit.authenticate_as('todo_other');
select results_eq($$ select to_check, captcha, unknown_field from public.lm_campaign_todo((select id from public.lm_campaigns where name = 'Camp')) $$,
  $$ values (0, 0, 0) $$, 'Compteurs vides pour une autre organisation');
select is_empty($$ select public.lm_campaign_todo_ids((select id from public.lm_campaigns where name = 'Camp'), 'to_check') $$,
  'Liste vide pour une autre organisation');
select is(public.lm_approve_attempts(array[pg_temp.att('doute')]), 0, 'Envoi refusé hors de son organisation');
select is(public.lm_skip_todo((select id from public.lm_campaigns where name = 'Camp'), 'to_check'), 0,
  '« Tout passer » refusé hors de son organisation');
select is(public.lm_autopilot_todo((select id from public.lm_autopilots)), 0, 'Bilan vide pour une autre organisation');
select is(public.lm_mark_sent_by_hand(array[pg_temp.att('captcha')]), 0, '« C''est envoyé » refusé hors de son organisation');

select makerkit.authenticate_as('todo_owner');

select is(public.lm_autopilot_todo((select id from public.lm_autopilots)), 3,
  'Bilan du pilote : douteux, site protégé, case (pas le prêt sans doute ni le formulaire hors pilote)');

-- « Envoyer » pendant la pause : l'accord est noté, rien n'attend « validé », il sort de la liste
select is(public.lm_approve_attempts(array[pg_temp.att('doute')]), 1, 'Formulaire douteux accepté');
set local role postgres;
select is((select status::text from public.lm_attempts where id = pg_temp.att('doute')), 'ready', 'Pilote en pause : il attend la reprise');
select isnt((select autopilot_id from public.lm_attempts where id = pg_temp.att('doute')), null, 'Il reste dans son pilote');
select is((select validated_by from public.lm_attempts where id = pg_temp.att('doute')), tests.get_supabase_uid('todo_owner'),
  'L''accord est enregistré');
select makerkit.authenticate_as('todo_owner');
select is((select to_check from public.lm_campaign_todo((select id from camp))), 1, 'Il n''est plus à vérifier');

-- Reprise : validé ; nouvelle pause puis reprise : l'accord n'est pas perdu
select ok(public.lm_resume_autopilot((select id from public.lm_autopilots)), 'Reprise');
set local role postgres;
select is((select status::text from public.lm_attempts where id = pg_temp.att('doute')), 'validated', 'Validé à la reprise');
select makerkit.authenticate_as('todo_owner');
select ok(public.lm_pause_autopilot((select id from public.lm_autopilots)), 'Nouvelle pause');
set local role postgres;
select is((select status::text from public.lm_attempts where id = pg_temp.att('doute')), 'ready', 'Pause : repassé prêt');
select makerkit.authenticate_as('todo_owner');
select is((select to_check from public.lm_campaign_todo((select id from camp))), 1, 'Toujours hors de la liste pendant la pause');
select ok(public.lm_resume_autopilot((select id from public.lm_autopilots)), 'Reprise encore');
set local role postgres;
select is((select status::text from public.lm_attempts where id = pg_temp.att('doute')), 'validated', 'Revalidé : accord gardé');
-- pilote en marche pour la suite
select makerkit.authenticate_as('todo_owner');

-- Case inconnue : refusé tant que la case est vide, accepté une fois remplie
select is(public.lm_approve_attempts(array[pg_temp.att('case')]), 0, 'Case vide : pas d''envoi');
select ok(public.lm_update_attempt(pg_temp.att('case'), 'Objet', 'Bonjour', '{"Calcul": "7"}'::jsonb), 'Case remplie');
select is(public.lm_approve_attempts(array[pg_temp.att('case')]), 1, 'Case remplie : envoyé');

-- Campagne archivée et formulaire déjà parti : rien ne bouge
select is(public.lm_approve_attempts(array[pg_temp.att('archive')]), 0, 'Jamais pour une campagne archivée');
select is(public.lm_approve_attempts(array[pg_temp.att('envoye')]), 0, 'Un formulaire déjà parti ne repart pas');

-- « C'est envoyé » : site protégé passé envoyé, avec l'heure, compté dans le pilote
select is(public.lm_mark_sent_by_hand(array[pg_temp.att('captcha')]), 1, 'Site protégé marqué envoyé');
select is(public.lm_mark_sent_by_hand(array[pg_temp.att('doute')]), 0, 'Seulement pour un site protégé');
set local role postgres;
select is((select status::text from public.lm_attempts where id = pg_temp.att('captcha')), 'sent', 'Statut envoyé');
select isnt((select sent_at from public.lm_attempts where id = pg_temp.att('captcha')), null, 'Heure d''envoi posée');
select is((select sent from public.lm_autopilot_counts((select id from public.lm_autopilots))), 2,
  'Compté dans les envois du pilote (avec celui déjà parti)');
select makerkit.authenticate_as('todo_owner');

select results_eq($$ select to_check, captcha, unknown_field from public.lm_campaign_todo((select id from camp)) $$,
  $$ values (1, 0, 0) $$, 'Il ne reste que le prêt hors pilote à vérifier');

-- « Passer » ne touche jamais un formulaire déjà accepté (autre onglet resté ouvert)
select is(public.lm_skip_todo((select id from camp), 'to_check', array[pg_temp.att('doute')]), 0,
  'Un formulaire déjà accepté n''est pas passé');
set local role postgres;
select is((select status::text from public.lm_attempts where id = pg_temp.att('doute')), 'validated', 'Il reste validé');
select makerkit.authenticate_as('todo_owner');

-- « Tout passer » : toute la liste
select is(public.lm_skip_todo((select id from camp), 'to_check'), 1, 'Tout passer');
select results_eq($$ select to_check, captcha, unknown_field from public.lm_campaign_todo((select id from camp)) $$,
  $$ values (0, 0, 0) $$, 'Plus rien à faire');

select * from finish();

rollback;
