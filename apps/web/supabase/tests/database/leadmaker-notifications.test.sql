-- Notifications e-mail (5/11/2026) : événements posés par les déclencheurs, dédoublonnés, réclamés avec leurs
-- destinataires, préférences respectées, rien de lisible par les clients.
begin;

select no_plan();

select tests.create_supabase_user('nt_a', 'nt_a@test.com');
select tests.create_supabase_user('nt_b', 'nt_b@test.com');

set local role service_role;
select public.create_team_account('Nt A', tests.get_supabase_uid('nt_a'), 'nt-a');
select public.create_team_account('Nt B', tests.get_supabase_uid('nt_b'), 'nt-b');
set local role postgres;

create temp table t_nt as
select (select id from public.accounts where slug = 'nt-a') as acc,
       (select s.id from public.lm_spaces s join public.accounts a on a.id = s.account_id where a.slug = 'nt-a' and s.is_default) as space;
grant select on t_nt to authenticated, service_role;

-- Inscription : notification pour l'équipe Prospectigo
select ok(exists (select 1 from public.lm_notifications where kind = 'admin_signup' and payload ->> 'email' = 'nt_a@test.com'),
  'Nouvel inscrit signalé');

-- Recherche terminée (une seule fois par jour)
insert into public.lm_campaigns (id, account_id, space_id, name, country_code, status)
select 'a0000000-0000-4000-8000-0000000a7001', acc, space, 'Campagne N', 'FR', 'running' from t_nt;
update public.lm_campaigns set status = 'completed' where id = 'a0000000-0000-4000-8000-0000000a7001';
update public.lm_campaigns set status = 'paused' where id = 'a0000000-0000-4000-8000-0000000a7001';
update public.lm_campaigns set status = 'completed' where id = 'a0000000-0000-4000-8000-0000000a7001';
select is((select count(*)::int from public.lm_notifications where kind = 'search_done'), 1,
  'Recherche terminée : une notification par jour, pas plus');

-- Arrêt faute de crédits
update public.lm_campaigns set status = 'running' where id = 'a0000000-0000-4000-8000-0000000a7001';
update public.lm_campaigns set status = 'paused', filters = filters || '{"paused_reason":"no_credits"}'
 where id = 'a0000000-0000-4000-8000-0000000a7001';
select is((select count(*)::int from public.lm_notifications where kind = 'search_no_credits'), 1,
  'Recherche arrêtée faute de crédits signalée');

-- Crédits sous 20 %
set local role service_role;
select public.lm_reset_credits((select acc from t_nt), 'growth', now() + interval '20 days', 'nt:renewal');
set local role postgres;
update public.lm_account_credits set discovery_balance = 10 where account_id = (select acc from t_nt);
update public.lm_account_credits set discovery_balance = 5 where account_id = (select acc from t_nt);
select is((select count(*)::int from public.lm_notifications where kind = 'credits_low' and payload ->> 'credit' = 'discovery'), 1,
  'Crédits de prospection bas : une seule notification par période');

-- Réclamation : destinataires = membres, sauf ceux qui ont coupé le groupe
set local role service_role;
create temp table t_claim as select * from public.lm_claim_notifications(100);
set local role postgres;
select is((select jsonb_array_length(recipients) from t_claim where kind = 'search_done'), 1, 'Destinataire : le membre de l''équipe');
select is((select recipients -> 0 ->> 'email' from t_claim where kind = 'search_done'), 'nt_a@test.com', 'Bonne adresse');
select is((select account_slug from t_claim where kind = 'search_done'), 'nt-a', 'Lien vers la bonne équipe');
select is((select count(*)::int from public.lm_notifications where status = 'sending'), (select count(*)::int from t_claim),
  'Notifications réclamées marquées « en cours »');

set local role service_role;
select public.lm_finish_notification((select id from t_claim where kind = 'search_done'), true);
set local role postgres;
select is((select status from public.lm_notifications where kind = 'search_done'), 'sent', 'Notification envoyée close');

-- Préférences : le groupe « credits » coupé → plus de destinataire
select makerkit.authenticate_as('nt_a');
select lives_ok($$ insert into public.lm_notification_preferences (user_id, disabled_groups)
                   values (auth.uid(), '{credits}') $$, 'Préférence enregistrée');
set local role postgres;
update public.lm_notifications set status = 'pending' where kind = 'credits_low';
set local role service_role;
select is((select jsonb_array_length(recipients) from public.lm_claim_notifications(100) where kind = 'credits_low'), 0,
  'Groupe coupé : aucun destinataire');
set local role postgres;

-- Cloisonnement
select makerkit.authenticate_as('nt_b');
select is((select count(*)::int from public.lm_notification_preferences), 0, 'Préférences des autres invisibles');
select throws_ok($$ select * from public.lm_notifications $$, '42501', null, 'File des notifications illisible pour un client');
select throws_ok($$ select * from public.lm_claim_notifications(10) $$, '42501', null, 'Réclamation réservée au serveur');
select throws_ok($$ insert into public.lm_notification_preferences (user_id, disabled_groups)
                   values (tests.get_supabase_uid('nt_a'), '{search}') $$, '42501', null,
  'Impossible d''écrire les préférences d''un autre');

select * from finish();

rollback;
