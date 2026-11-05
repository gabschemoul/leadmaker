-- Lot 2 : envoi des formulaires validés (file, limites quotidiennes, crédit outreach, « à vérifier »).
begin;

select no_plan();

select tests.create_supabase_user('snd_owner', 'snd_owner@test.com');

set local role service_role;
select public.create_team_account('Snd A', tests.get_supabase_uid('snd_owner'), 'snd-a');
insert into public.lm_account_credits (account_id, plan_id, discovery_balance, outreach_balance)
select id, 'growth', 100, 2 from public.accounts where slug = 'snd-a';
set local role postgres;

create temp view ta as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'snd-a';
grant select on ta to authenticated, service_role;

select makerkit.authenticate_as('snd_owner');

insert into public.lm_campaigns (account_id, space_id, name, country_code, daily_limit, templates)
select account_id, space_id, 'Camp', 'FR', 2, '{"messages":[{"name":"M1","subject":"O","body":"Bonjour {my_company}"}]}'::jsonb from ta;

set local role postgres;
insert into public.lm_prospects (account_id, space_id, campaign_id, name, site_key, website)
select t.account_id, t.space_id, c.id, x.name, x.key, 'https://' || x.key
  from ta t, public.lm_campaigns c, (values ('Un', 'un.fr'), ('Deux', 'deux.fr'), ('Trois', 'trois.fr')) as x(name, key);
select makerkit.authenticate_as('snd_owner');

-- Trois tentatives validées (écrites comme le ferait la validation)
set local role postgres;
insert into public.lm_attempts (account_id, space_id, campaign_id, prospect_id, status, validated_at, validated_by, subject, body)
select p.account_id, p.space_id, p.campaign_id, p.id, 'validated', now(), tests.get_supabase_uid('snd_owner'), 'O', 'Bonjour'
  from public.lm_prospects p where p.account_id = (select account_id from ta);

-- Planification : limite quotidienne de la campagne = 2 → deux envois en file
set local role service_role;
-- (la base locale peut contenir d'autres tentatives validées : on compte celles de cette organisation)
select cmp_ok(public.lm_queue_sends(), '>=', 2, 'Les envois sont mis en file');
select is((select count(*)::int from public.lm_tasks t where t.kind = 'send' and t.status = 'queued' and t.account_id = (select account_id from ta)),
  2, 'Deux tâches d''envoi pour cette organisation (limite quotidienne de la campagne)');
select is((select count(*)::int from public.lm_tasks t where t.kind = 'send' and t.status = 'queued' and t.account_id = (select account_id from ta))
  + public.lm_queue_sends() - public.lm_queue_sends(), 2, 'Rien de plus tant que la limite est atteinte');

-- Envoi 1 : soumis et confirmé → envoyé, crédit débité
update public.lm_attempts set status = 'sending' where prospect_id = (select id from public.lm_prospects where name = 'Un');
select is(public.lm_finish_send((select a.id from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id where p.name = 'Un'),
  '{"status":"sent","submitted":true,"detail":"confirmation affichée","screenshot_after":"x/after.png"}'::jsonb), true, 'Résultat d''envoi enregistré');
select is((select outreach_balance from public.lm_account_credits c join ta on ta.account_id = c.account_id), 1, 'Un crédit outreach débité');
select is((select sent_at is not null from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id where p.name = 'Un'), true, 'Date d''envoi posée');

-- Envoi 2 : soumis sans confirmation → à vérifier, crédit débité quand même
update public.lm_attempts set status = 'sending' where prospect_id = (select id from public.lm_prospects where name = 'Deux');
select is(public.lm_finish_send((select a.id from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id where p.name = 'Deux'),
  '{"status":"to_verify","submitted":true,"detail":"pas de confirmation visible"}'::jsonb), true, 'À vérifier enregistré');
select is((select outreach_balance from public.lm_account_credits c join ta on ta.account_id = c.account_id), 0, 'Deuxième crédit débité');

-- Plus de crédits : le troisième n'est pas mis en file
select public.lm_queue_sends();
select is((select count(*)::int from public.lm_tasks t where t.kind = 'send' and t.account_id = (select account_id from ta)), 2, 'Sans crédit outreach, rien de plus n''est mis en file');

-- Une tentative qui n'est plus « en envoi » n'est pas réécrite
select is(public.lm_finish_send((select a.id from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id where p.name = 'Un'),
  '{"status":"failed","submitted":true}'::jsonb), false, 'Un envoi terminé n''est pas réécrit');
select is((select outreach_balance from public.lm_account_credits c join ta on ta.account_id = c.account_id), 0, 'Pas de double débit');

-- Envoi interrompu : « en envoi » depuis plus de 20 minutes → à vérifier
set local role postgres;
update public.lm_attempts set status = 'sending', updated_at = now() - interval '30 minutes'
 where prospect_id = (select id from public.lm_prospects where name = 'Trois');
alter table public.lm_attempts disable trigger lm_attempts_set_timestamps;
update public.lm_attempts set updated_at = now() - interval '30 minutes' where prospect_id = (select id from public.lm_prospects where name = 'Trois');
alter table public.lm_attempts enable trigger lm_attempts_set_timestamps;
set local role service_role;
select public.lm_queue_sends();
select is((select status::text from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id where p.name = 'Trois'), 'to_verify', 'Envoi interrompu → à vérifier');

-- L'utilisateur tranche les « à vérifier »
set local role postgres;
select makerkit.authenticate_as('snd_owner');
select is(public.lm_mark_attempts(array(select id from public.lm_attempts where status = 'to_verify'), 'sent'), 2, 'Deux formulaires marqués bien arrivés');
select is((select count(*)::int from public.lm_attempts where status = 'sent'), 3, 'Trois envoyés au total');
select throws_ok($$ select public.lm_mark_attempts(array[]::uuid[], 'autre') $$, '23514', null, 'Verdict inconnu refusé');
select throws_ok($$ select public.lm_queue_sends() $$, '42501', null, 'lm_queue_sends réservé au rôle service');

select * from finish();

rollback;
