-- Roadmap n°18 : pilote automatique de l'étape « Contacter » (lancement, préparation dans l'ordre, test A/B,
-- validation des formulaires sans doute, cas douteux mis de côté, pause/reprise, aperçu, fin, isolation).
begin;

select no_plan();

select tests.create_supabase_user('ap_owner', 'ap_owner@test.com');
select tests.create_supabase_user('ap_other', 'ap_other@test.com');

set local role service_role;
select public.create_team_account('Ap A', tests.get_supabase_uid('ap_owner'), 'ap-a');
select public.create_team_account('Ap B', tests.get_supabase_uid('ap_other'), 'ap-b');
set local role postgres;

create temp view ta as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'ap-a';
grant select on ta to authenticated, service_role;

-- Forfait Growth (le pilote est ouvert à tous les forfaits) : 100 crédits de prise de contact
insert into public.lm_account_credits (account_id, plan_id, discovery_balance, outreach_balance)
select account_id, 'growth', 100, 100 from ta;

insert into public.lm_sender_profiles (account_id, space_id, first_name, last_name, company, email, country_code)
select account_id, space_id, 'Laurie', 'Test', 'Agence', 'l@test.com', 'FR' from ta;

insert into public.lm_campaigns (account_id, space_id, name, country_code, templates)
select account_id, space_id, x.name, 'FR',
       '{"messages":[{"name":"M1","subject":"Objet","body":"Bonjour {company}, ici {my_company}"},{"name":"M2","subject":"Objet","body":"Salut {company}, ici {my_company}"},{"name":"Vide","subject":"","body":"  "}]}'::jsonb
  from ta, (values ('Camp'), ('Camp2'), ('Camp3')) as x(name);

-- 9 prospects contactables trouvés dans l'ordre P1…P9, plus un exclu et un sans site (jamais pris)
insert into public.lm_prospects (account_id, space_id, campaign_id, name, site_key, website, excluded_at, created_at)
select t.account_id, t.space_id, c.id, 'P' || n, 'p' || n || '.fr', 'https://p' || n || '.fr', null, now() - (20 - n) * interval '1 minute'
  from ta t, public.lm_campaigns c, generate_series(1, 9) n
 where c.name = 'Camp';
insert into public.lm_prospects (account_id, space_id, campaign_id, name, site_key, website, excluded_at, created_at)
select t.account_id, t.space_id, c.id, x.name, x.key, x.site, x.excl, now() - interval '1 hour'
  from ta t, public.lm_campaigns c,
       (values ('Exclu', 'exclu.fr', 'https://exclu.fr', now()), ('SansSite', 'maps:0x1', null, null::timestamptz)) as x(name, key, site, excl)
 where c.name = 'Camp';
insert into public.lm_prospects (account_id, space_id, campaign_id, name, site_key, website, created_at)
select t.account_id, t.space_id, c.id, c.name || '-Q' || n, lower(c.name) || '-q' || n || '.fr', 'https://' || lower(c.name) || '-q' || n || '.fr',
       now() - (20 - n) * interval '1 minute'
  from ta t, public.lm_campaigns c, generate_series(1, 5) n
 where c.name in ('Camp2', 'Camp3');

-- L'horodatage est posé par un déclencheur (même instant dans la transaction) : ordre de découverte rejoué ici
alter table public.lm_prospects disable trigger lm_prospects_set_timestamps;
update public.lm_prospects p set created_at = now() - (100 - coalesce(substring(p.name from '(\d+)$')::int, 0)) * interval '1 minute'
 where p.account_id = (select account_id from ta) and p.name ~ '\d+$';
alter table public.lm_prospects enable trigger lm_prospects_set_timestamps;

create temp view camp as select id from public.lm_campaigns where name = 'Camp';
create temp view camp2 as select id from public.lm_campaigns where name = 'Camp2';
create temp view camp3 as select id from public.lm_campaigns where name = 'Camp3';
grant select on camp, camp2, camp3 to authenticated, service_role;

create temp table ap_ids (name text primary key, id uuid);
grant select, insert on ap_ids to authenticated, service_role;

-- Fonction d'aide : tentative du pilote d'un prospect
create function pg_temp.att(p_name text) returns uuid language sql as $$
  select a.id from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id where p.name = p_name
$$;
grant execute on function pg_temp.att(text) to authenticated, service_role;

-- Un tour de robot d'envoi, au moins 5 secondes après le précédent (le temps ne passe pas dans la transaction)
create function pg_temp.tour() returns integer language sql as $$
  update public.lm_autopilots set ticked_at = null;
  select public.lm_queue_sends();
$$;
grant execute on function pg_temp.tour() to authenticated, service_role;

select makerkit.authenticate_as('ap_owner');

select is((select contactable from public.lm_autopilot_summary((select id from camp))), 9, '9 prospects contactables (exclu et sans site écartés)');
select is((select contacted_before from public.lm_autopilot_summary((select id from camp))), false, 'Aucun message encore envoyé par l''organisation');
select is((select autopilot_id from public.lm_autopilot_summary((select id from camp))), null, 'Aucun pilote encore lancé');

-- Contrôles du lancement
select throws_ok($$ select public.lm_start_autopilot((select id from camp), 5, array['Inconnu'], 'continuous', 5, false) $$,
  'P0001', null, 'Message inconnu refusé');
select throws_ok($$ select public.lm_start_autopilot((select id from camp), 5, array['Vide'], 'continuous', 5, false) $$,
  'P0001', null, 'Message vide refusé');
select throws_ok($$ select public.lm_start_autopilot((select id from camp), 0, array['M1'], 'continuous', 5, false) $$,
  'P0001', null, 'Nombre nul refusé');

-- Lancement : 5 prises de contact, test A/B M1 / M2, en continu, sans aperçu
insert into ap_ids select 'camp', public.lm_start_autopilot((select id from camp), 5, array['M1', 'M2'], 'continuous', 5, false);

select is((select status::text from public.lm_autopilots where id = (select id from ap_ids where name = 'camp')), 'running', 'Pilote en marche');
select is((select count(*)::int from public.lm_attempts where autopilot_id = (select id from ap_ids where name = 'camp')), 5,
  'Cinq formulaires mis en préparation tout de suite');
select is((select string_agg(p.name, ',' order by p.created_at) from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id
            where a.autopilot_id = (select id from ap_ids where name = 'camp')), 'P1,P2,P3,P4,P5',
  'Pris dans l''ordre où ils ont été trouvés');
select is((select string_agg(a.template_name, ',' order by p.created_at) from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id
            where a.autopilot_id = (select id from ap_ids where name = 'camp')), 'M1,M2,M1,M2,M1',
  'Test A/B : messages répartis à parts égales');
select is((select count(*)::int from public.lm_tasks where kind = 'prepare'
            and payload ->> 'attempt_id' in (select id::text from public.lm_attempts where autopilot_id = (select id from ap_ids where name = 'camp'))),
  5, 'Une tâche de préparation par formulaire');
select throws_ok($$ select public.lm_start_autopilot((select id from camp), 5, array['M1'], 'continuous', 5, false) $$,
  'P0001', null, 'Un seul pilote actif par campagne');

-- Un membre d'une autre organisation ne voit rien et ne peut rien faire
select makerkit.authenticate_as('ap_other');
select is((select count(*)::int from public.lm_autopilots), 0, 'Pilote invisible pour une autre organisation');
select is((select count(*)::int from public.lm_autopilot_summary((select id from public.lm_campaigns where name = 'Camp'))), 0,
  'Résumé vide pour une autre organisation');
select throws_ok($$ select public.lm_start_autopilot((select id from public.lm_campaigns where name = 'Camp'), 5, array['M1'], 'continuous', 5, false) $$,
  'P0001', null, 'Lancement refusé hors de son organisation');
select throws_ok($$ select public.lm_pause_autopilot((select id from ap_ids where name = 'camp')) $$,
  'P0001', null, 'Pause refusée hors de son organisation');
select throws_ok($$ select public.lm_autopilot_tick() $$, '42501', null, 'Le tour du pilote est réservé au rôle service');
select throws_ok($$ insert into public.lm_autopilots (account_id, space_id, campaign_id, target, messages)
                    select account_id, space_id, (select id from camp), 5, array['M1'] from ta $$,
  '42501', null, 'Pas d''écriture directe dans la table du pilote');

-- Les robots préparent : 2 prêts sans doute (dont un en version courte), 3 cas douteux
set local role service_role;
select public.lm_finish_prepare(pg_temp.att('P1'), '{"status":"ready","template_name":"M1","subject":"Objet","body":"Bonjour P1"}'::jsonb);
select public.lm_finish_prepare(pg_temp.att('P2'), '{"status":"ready","template_name":"M2","subject":"Objet","body":"Salut P2","detail":"version courte utilisée (zone de message limitée)"}'::jsonb);
select public.lm_finish_prepare(pg_temp.att('P3'), '{"status":"intervention_required","template_name":"M1","protection_type":"recaptcha"}'::jsonb);
select public.lm_finish_prepare(pg_temp.att('P4'), '{"status":"no_form","template_name":"M2"}'::jsonb);
select public.lm_finish_prepare(pg_temp.att('P5'), '{"status":"ready","template_name":"M1","detail":"champ « Société » rempli au hasard"}'::jsonb);

select is((select string_agg(status::text, ',' order by p.created_at) from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id
            where a.autopilot_id = (select id from ap_ids where name = 'camp')), 'validated,validated,intervention_required,no_form,ready',
  'Formulaires sans doute validés tout seuls, cas douteux mis de côté');
select is((select (sent, in_flight, aside)::text from public.lm_autopilot_counts((select id from ap_ids where name = 'camp'))), '(0,2,3)',
  'Compteurs : 0 envoyé, 2 en cours, 3 mis de côté');

-- Tour suivant (robots d'envoi) : les 2 validés partent tout de suite, 3 prospects de plus pour remplacer les douteux
select cmp_ok(pg_temp.tour(), '>=', 2, 'Les envois du pilote sont mis en file');
select is((select count(*)::int from public.lm_attempts where autopilot_id = (select id from ap_ids where name = 'camp')), 8,
  'Trois nouveaux prospects remplacent les cas douteux');
select is((select count(*)::int from public.lm_tasks t where t.kind = 'send' and t.status = 'queued' and t.run_after <= now()
            and t.payload ->> 'attempt_id' in (select id::text from public.lm_attempts where autopilot_id = (select id from ap_ids where name = 'camp'))),
  2, 'En continu : envois prêts à partir tout de suite');
select is(pg_temp.tour(), 0, 'Pas de double mise en file');

-- Pause : rien ne part, rien n'attend « validé » (pas de fausse alerte du surveillant)
set local role postgres;
select makerkit.authenticate_as('ap_owner');
select is(public.lm_pause_autopilot((select id from ap_ids where name = 'camp')), true, 'Pause');
select is((select count(*)::int from public.lm_attempts where autopilot_id = (select id from ap_ids where name = 'camp') and status = 'validated'),
  0, 'En pause, plus aucun formulaire « validé » en attente');
select is((select count(*)::int from public.lm_tasks t where t.status = 'queued'
            and t.payload ->> 'attempt_id' in (select id::text from public.lm_attempts where autopilot_id = (select id from ap_ids where name = 'camp'))),
  0, 'En pause, plus aucune tâche en file');
set local role service_role;
select pg_temp.tour();
select is((select count(*)::int from public.lm_tasks t where t.status = 'queued'
            and t.payload ->> 'attempt_id' in (select id::text from public.lm_attempts where autopilot_id = (select id from ap_ids where name = 'camp'))),
  0, 'Les robots ne reprennent rien pendant la pause');

-- Reprise : les formulaires sans doute sont revalidés, les préparations interrompues repartent
set local role postgres;
select makerkit.authenticate_as('ap_owner');
select is(public.lm_resume_autopilot((select id from ap_ids where name = 'camp')), true, 'Reprise');
select is((select string_agg(status::text, ',' order by p.created_at) from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id
            where a.autopilot_id = (select id from ap_ids where name = 'camp') and p.name in ('P1', 'P2', 'P5')), 'validated,validated,ready',
  'À la reprise, seuls les formulaires sans doute sont revalidés');
select is((select count(*)::int from public.lm_tasks t where t.kind = 'prepare' and t.status = 'queued'
            and t.payload ->> 'attempt_id' in (select id::text from public.lm_attempts where autopilot_id = (select id from ap_ids where name = 'camp') and status = 'pending')),
  3, 'Les préparations interrompues sont remises en file');

-- Modifier le nombre : jamais sous ce qui est parti ou en cours (2 validés + 3 en préparation)
select is(public.lm_update_autopilot((select id from ap_ids where name = 'camp'), 1, array['M1', 'M2'], 'continuous', 5), 5,
  'Le nombre ne descend pas sous les formulaires en cours');
select is(public.lm_update_autopilot((select id from ap_ids where name = 'camp'), 1000, array['M1', 'M2'], 'continuous', 5), 6,
  'Le nombre est plafonné aux prospects restants');

-- Les 3 préparations finissent sans formulaire ; les 2 validés partent
set local role service_role;
select public.lm_finish_prepare(pg_temp.att(n), '{"status":"no_form"}'::jsonb) from unnest(array['P6', 'P7', 'P8']) n;
update public.lm_attempts set status = 'sending' where id in (pg_temp.att('P1'), pg_temp.att('P2'));
select public.lm_finish_send(pg_temp.att('P1'), '{"status":"sent","submitted":true}'::jsonb);
select public.lm_finish_send(pg_temp.att('P2'), '{"status":"to_verify","submitted":true}'::jsonb);
select is((select outreach_balance from public.lm_account_credits c join ta on ta.account_id = c.account_id), 100,
  'Crédit unique (9/11) : les envois ne débitent plus rien');

select pg_temp.tour();
select is((select count(*)::int from public.lm_attempts where autopilot_id = (select id from ap_ids where name = 'camp')), 9,
  'Le dernier prospect contactable est pris');
select public.lm_finish_prepare(pg_temp.att('P9'), '{"status":"unreachable"}'::jsonb);
select pg_temp.tour();
select is((select (status, finished_reason)::text from public.lm_autopilots where id = (select id from ap_ids where name = 'camp')),
  '(done,no_prospects)', 'Plus aucun prospect : pilote terminé');
select is((select (sent, in_flight, aside)::text from public.lm_autopilot_counts((select id from ap_ids where name = 'camp'))), '(2,0,7)',
  'Bilan : 2 envoyés, 7 mis de côté');

-- Un cas douteux re-préparé à la main (mode Avancé) quitte le pilote et le robot rechoisira son message
set local role postgres;
select makerkit.authenticate_as('ap_owner');
select is((select queued from public.lm_prepare_prospects(array[(select id from public.lm_prospects where name = 'P4')])), 1,
  'Re-préparation manuelle d''un cas mis de côté');
select is((select (autopilot_id is null and template_name is null)::text from public.lm_attempts where id = pg_temp.att('P4')), 'true',
  'Il quitte le pilote, message à rechoisir');
select is((select contacted_before from public.lm_autopilot_summary((select id from camp))), true, 'L''organisation a déjà envoyé un message');

-- Aperçu : 3 formulaires prêts, rien ne part avant confirmation
insert into ap_ids select 'camp2', public.lm_start_autopilot((select id from camp2), 4, array['M1'], 'continuous', 5, true);
select is((select status::text from public.lm_autopilots where id = (select id from ap_ids where name = 'camp2')), 'preview', 'Aperçu demandé');
select is((select count(*)::int from public.lm_attempts where autopilot_id = (select id from ap_ids where name = 'camp2')), 3,
  'Trois formulaires préparés pour l''aperçu');
set local role service_role;
select public.lm_finish_prepare(pg_temp.att('Camp2-Q1'), '{"status":"ready","template_name":"M1"}'::jsonb);
select public.lm_finish_prepare(pg_temp.att('Camp2-Q2'), '{"status":"no_form"}'::jsonb);
select public.lm_finish_prepare(pg_temp.att('Camp2-Q3'), '{"status":"ready","template_name":"M1"}'::jsonb);
select is((select count(*)::int from public.lm_attempts where autopilot_id = (select id from ap_ids where name = 'camp2') and status = 'validated'), 0,
  'En aperçu, rien n''est validé tout seul');
select pg_temp.tour();
select is((select count(*)::int from public.lm_attempts where autopilot_id = (select id from ap_ids where name = 'camp2')), 4,
  'Un prospect de plus pour remplacer celui sans formulaire');
select is((select count(*)::int from public.lm_tasks t where t.kind = 'send'
            and t.payload ->> 'attempt_id' in (select id::text from public.lm_attempts where autopilot_id = (select id from ap_ids where name = 'camp2'))),
  0, 'Aucun envoi pendant l''aperçu');
set local role postgres;
select makerkit.authenticate_as('ap_owner');
select is((select preview_ready from public.lm_autopilot_summary((select id from camp2))), 2, 'Deux formulaires prêts à montrer');
select is(public.lm_confirm_autopilot((select id from ap_ids where name = 'camp2')), 2, 'Confirmation : les formulaires de l''aperçu sont validés');
select is((select status::text from public.lm_autopilots where id = (select id from ap_ids where name = 'camp2')), 'running', 'Le pilote démarre');

-- Heures de bureau : un envoi part dans le créneau (lundi-vendredi 9 h-18 h, heure locale), jamais en dehors
select public.lm_update_autopilot((select id from ap_ids where name = 'camp2'), 4, array['M1'], 'office', 5);
set local role service_role;
select pg_temp.tour();
select ok((select bool_and(t.run_after >= now() - interval '1 second'
                  and extract(dow from t.run_after at time zone ap.timezone) between 1 and 5
                  and (t.run_after at time zone ap.timezone)::time >= time '09:00'
                  and (t.run_after at time zone ap.timezone)::time < time '18:00')
             from public.lm_tasks t
             join public.lm_attempts a on a.id::text = t.payload ->> 'attempt_id'
             join public.lm_autopilots ap on ap.id = a.autopilot_id
            where t.kind = 'send' and t.status = 'queued' and ap.id = (select id from ap_ids where name = 'camp2')),
  'Heures de bureau : envois programmés dans le créneau');

-- Étalé : 4 envois sur 2 jours ouvrés = 2 par jour, à 4 h 30 d'intervalle, dans les heures de bureau
select public.lm_autopilot_hold((select id from ap_ids where name = 'camp2'), true);
update public.lm_autopilots set schedule = 'spread', spread_days = 2, timezone = 'Europe/Paris'
 where id = (select id from ap_ids where name = 'camp2');
select ok(public.lm_autopilot_slot((select id from ap_ids where name = 'camp2')) >= now() - interval '1 second', 'Étalé : jamais dans le passé');
select pg_temp.tour();
select ok((select count(*) = 2
             and max(t.run_after) - min(t.run_after) >= interval '4 hours 30 minutes'
             and bool_and((t.run_after at time zone 'Europe/Paris')::time >= time '09:00'
                          and (t.run_after at time zone 'Europe/Paris')::time < time '18:00'
                          and extract(dow from t.run_after at time zone 'Europe/Paris') between 1 and 5)
             from public.lm_tasks t
             join public.lm_attempts a on a.id::text = t.payload ->> 'attempt_id'
            where t.kind = 'send' and t.status = 'queued' and a.autopilot_id = (select id from ap_ids where name = 'camp2')),
  'Étalé : rythme régulier (pas de rafale), dans les heures de bureau');

-- Annuler l'aperçu : préparations retirées, prospects de nouveau contactables
set local role postgres;
select makerkit.authenticate_as('ap_owner');
insert into ap_ids select 'camp3', public.lm_start_autopilot((select id from camp3), 2, array['M2'], 'office', 5, true);
select is(public.lm_cancel_autopilot((select id from ap_ids where name = 'camp3')), true, 'Aperçu annulé');
select is((select status::text from public.lm_autopilots where id = (select id from ap_ids where name = 'camp3')), 'cancelled', 'Pilote annulé');
select is((select contactable from public.lm_autopilot_summary((select id from camp3))), 5, 'Les prospects redeviennent contactables');

-- Plus de forfait ni de crédits : lancement refusé (crédit unique, 9/11 : les envois ne demandent plus de
-- crédits de prise de contact, seulement un forfait)
set local role postgres;
update public.lm_account_credits set plan_id = null, discovery_balance = 0, outreach_balance = 0
 where account_id = (select account_id from ta);
select makerkit.authenticate_as('ap_owner');
select throws_ok($$ select public.lm_start_autopilot((select id from camp3), 2, array['M2'], 'office', 5, false) $$,
  'P0001', null, 'Lancement refusé sans forfait');
set local role postgres;
update public.lm_account_credits set plan_id = 'growth', discovery_balance = 100, outreach_balance = 100
 where account_id = (select account_id from ta);
select makerkit.authenticate_as('ap_owner');

-- Validation automatique des campagnes ouverte à tous les forfaits (Growth compris)
select is(public.lm_auto_validation_allowed((select account_id from ta)), true, 'Validation automatique permise en Growth');

-- Relecture (2/11) : cas limites
set local role postgres;
update public.lm_account_credits set outreach_balance = 100 where account_id = (select account_id from ta);

-- Validation manuelle (mode Avancé) d'un formulaire mis de côté : il quitte le pilote et part normalement
select makerkit.authenticate_as('ap_owner');
select is(public.lm_update_attempt(pg_temp.att('P5'), 'Objet', 'Bonjour P5', '{}'::jsonb), true, 'Formulaire du pilote complété à la main');
select is(public.lm_validate_attempts(array[pg_temp.att('P5')]), 1, 'Validé à la main');
select is((select autopilot_id from public.lm_attempts where id = pg_temp.att('P5')), null, 'Validé à la main : il quitte le pilote');
set local role service_role;
select pg_temp.tour();
select is((select count(*)::int from public.lm_tasks where kind = 'send' and status = 'queued' and payload ->> 'attempt_id' = pg_temp.att('P5')::text), 1,
  'Il part par l''envoi normal (pas bloqué par un pilote terminé)');

-- Validation automatique de campagne : sans effet sur les formulaires d'un pilote (aperçu respecté)
set local role postgres;
update public.lm_campaigns set auto_validation = true where name = 'Camp3';
select makerkit.authenticate_as('ap_owner');
insert into ap_ids select 'camp3b', public.lm_start_autopilot((select id from camp3), 2, array['M2'], 'continuous', 5, true);
set local role service_role;
select public.lm_finish_prepare(pg_temp.att('Camp3-Q1'), '{"status":"ready","template_name":"M2"}'::jsonb);
select is((select status::text from public.lm_attempts where id = pg_temp.att('Camp3-Q1')), 'ready',
  'Aperçu : la validation automatique de la campagne ne s''applique pas au pilote');

-- Préparation interrompue (robot arrêté pendant la visite) : remise en file au tour suivant
set local role postgres;
alter table public.lm_attempts disable trigger lm_attempts_set_timestamps;
update public.lm_attempts set status = 'preparing', updated_at = now() - interval '1 hour' where id = pg_temp.att('Camp3-Q2');
alter table public.lm_attempts enable trigger lm_attempts_set_timestamps;
update public.lm_tasks set status = 'done' where payload ->> 'attempt_id' = pg_temp.att('Camp3-Q2')::text;
set local role service_role;
select pg_temp.tour();
select is((select status::text from public.lm_attempts where id = pg_temp.att('Camp3-Q2')), 'pending', 'Préparation interrompue remise en attente');
select is((select count(*)::int from public.lm_tasks where kind = 'prepare' and status = 'queued' and payload ->> 'attempt_id' = pg_temp.att('Camp3-Q2')::text), 1,
  'et remise en file');

-- Crédits partagés entre pilotes : jamais plus de formulaires en cours que de crédits restants
set local role postgres;
update public.lm_account_credits set outreach_balance = 4 where account_id = (select account_id from ta);
select is(public.lm_outreach_reserved((select account_id from ta)) >= 2, true, 'Formulaires en cours comptés dans les crédits réservés');
set local role service_role;
select pg_temp.tour();
select ok((select count(*) from public.lm_tasks t where t.kind = 'send' and t.status in ('queued', 'running')
             and t.account_id = (select account_id from ta)) <= 4, 'Jamais plus d''envois en file que de crédits');

select * from finish();

rollback;
