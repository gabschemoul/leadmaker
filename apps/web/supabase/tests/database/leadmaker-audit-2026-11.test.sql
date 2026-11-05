-- Audit du 5/11/2026 (docs/prospectigo/AUDIT-2026-11-05.md) : chaque faille corrigée a son test ici.
begin;

select no_plan();

select tests.create_supabase_user('au_a', 'au_a@test.com');
select tests.create_supabase_user('au_b', 'au_b@test.com');

set local role service_role;
select public.create_team_account('Au A', tests.get_supabase_uid('au_a'), 'au-a');
select public.create_team_account('Au B', tests.get_supabase_uid('au_b'), 'au-b');
set local role postgres;

insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
insert into public.lm_country_coverage (country_code, name) values ('ZX', 'Auditland') on conflict do nothing;
insert into public.lm_geo_cities (geoname_id, name, ascii_name, country_code, population, latitude, longitude) values
  (990000701, 'Auditon', 'Auditon', 'ZX', 20000, 42.0, 42.0)
on conflict do nothing;
insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded) values
  ('gcid:au_one', 'Au one', 'Au un', 'Test', false, false),
  ('gcid:au_two', 'Au two', 'Au deux', 'Test', false, false)
on conflict do nothing;

create temp table t_au as
select (select id from public.accounts where slug = 'au-a') as acc_a,
       (select s.id from public.lm_spaces s join public.accounts a on a.id = s.account_id where a.slug = 'au-a' and s.is_default) as space_a,
       (select id from public.accounts where slug = 'au-b') as acc_b,
       (select s.id from public.lm_spaces s join public.accounts a on a.id = s.account_id where a.slug = 'au-b' and s.is_default) as space_b;
grant select on t_au to authenticated, service_role;

-- Campagne de B (la « victime »)
insert into public.lm_campaigns (id, account_id, space_id, name, country_code, targeting, filters)
select 'a0000000-0000-4000-8000-00000000a0b1', acc_b, space_b, 'Campagne B', 'ZX',
       '{"cities":{"mode":"list","geoname_ids":[990000701]},"categories":{"mode":"list","gcids":["gcid:au_one"]}}', '{}'
  from t_au;

-- ── A1 : plus d'INSERT direct de prospects, ni de rattachement à la campagne d'un autre espace ─────────────
select makerkit.authenticate_as('au_a');
select throws_ok(
  $$ insert into public.lm_prospects (account_id, space_id, name, site_key, website, campaign_id)
     select acc_a, space_a, 'Intrus', 'intrus.example', 'https://intrus.example', 'a0000000-0000-4000-8000-00000000a0b1'
       from t_au $$,
  '42501', null, 'A1 : un client ne peut plus insérer de prospect directement');
set local role postgres;

select throws_ok(
  $$ insert into public.lm_prospects (account_id, space_id, name, site_key, website, campaign_id)
     select acc_a, space_a, 'Intrus', 'intrus.example', 'https://intrus.example', 'a0000000-0000-4000-8000-00000000a0b1'
       from t_au $$,
  '23514', null, 'A1 : un prospect ne peut pas être rattaché à la campagne d''un autre espace');

-- ── A3 : colonnes de tarif et de statut non modifiables par le client ─────────────────────────────────────
select makerkit.authenticate_as('au_a');
select throws_ok(
  $$ insert into public.lm_campaigns (account_id, space_id, name, country_code, status, price_pending)
     select acc_a, space_a, 'Triche', 'ZX', 'running', true from t_au $$,
  '42501', null, 'A3 : statut et tarif impossibles à fixer à la création');
select lives_ok(
  $$ insert into public.lm_campaigns (id, account_id, space_id, name, country_code, targeting, filters)
     select 'a0000000-0000-4000-8000-00000000a0a1', acc_a, space_a, 'Campagne A', 'ZX',
            '{"cities":{"mode":"list","geoname_ids":[990000701]},"categories":{"mode":"list","gcids":["gcid:au_one"]}}', '{}'
       from t_au $$,
  'Création normale d''une campagne');
select throws_ok(
  $$ update public.lm_campaigns set filters = '{"website":"without"}' where id = 'a0000000-0000-4000-8000-00000000a0a1' $$,
  '42501', null, 'A2 : les filtres ne se changent plus en direct (seulement par lm_update_campaign)');

-- A8 : filtres complétés par défaut (site web exigé)
select is((select filters ->> 'website' from public.lm_campaigns where id = 'a0000000-0000-4000-8000-00000000a0a1'),
  'with', 'A8 : filtres normalisés à la création');

-- ── A3 : quota d'estimations (sans forfait : 3 par 24 h) ─────────────────────────────────────────────────
select lives_ok($$ select public.lm_request_estimate((select acc_a from t_au), 'ZX',
  '{"cities":{"mode":"list","geoname_ids":[990000701]},"categories":{"mode":"list","gcids":["gcid:au_one"]}}', '{}') $$, 'Estimation 1');
select lives_ok($$ select public.lm_request_estimate((select acc_a from t_au), 'ZX',
  '{"cities":{"mode":"list","geoname_ids":[990000701]},"categories":{"mode":"list","gcids":["gcid:au_one"]}}', '{}') $$, 'Estimation 2');
select lives_ok($$ select public.lm_request_estimate((select acc_a from t_au), 'ZX',
  '{"cities":{"mode":"list","geoname_ids":[990000701]},"categories":{"mode":"list","gcids":["gcid:au_one"]}}', '{}') $$, 'Estimation 3');
select throws_ok($$ select public.lm_request_estimate((select acc_a from t_au), 'ZX',
  '{"cities":{"mode":"list","geoname_ids":[990000701]},"categories":{"mode":"list","gcids":["gcid:au_one"]}}', '{}') $$,
  'P0001', 'estimate quota reached', 'A3 : 4e estimation du jour refusée sans forfait');
select throws_ok($$ select public.lm_request_estimate((select acc_b from t_au), 'ZX', '{}', '{}') $$,
  'P0002', null, 'Estimation pour une autre organisation refusée');
select throws_ok($$ select public.lm_create_estimate((select acc_a from t_au), 'ZX', '{}', '{}') $$,
  '42501', null, 'lm_create_estimate est interne');

-- ── A9 : robots réservés aux forfaits, plafond non modifiable ────────────────────────────────────────────
select throws_ok($$ update public.lm_spaces set ready_forms_cap = 100000 $$,
  '42501', null, 'A9 : plafond de formulaires non modifiable par le client');
select throws_ok($$ select public.lm_seat_limit((select acc_b from t_au)) $$,
  '42501', null, 'A15 : quota de sièges d''un autre compte illisible');

set local role postgres;
insert into public.lm_prospects (account_id, space_id, name, site_key, website, campaign_id)
select acc_a, space_a, 'Un', 'un.example', 'https://un.example', 'a0000000-0000-4000-8000-00000000a0a1' from t_au;
select makerkit.authenticate_as('au_a');
select throws_ok($$ select * from public.lm_find_emails(array(select id from public.lm_prospects)) $$,
  'P0001', null, 'A9 : recherche d''e-mails refusée sans forfait');

-- ── A5 / A10 / A16 : import nettoyé ──────────────────────────────────────────────────────────────────────
set local role postgres;
insert into public.lm_suppressions (account_id, space_id, site_key, reason) values (null, null, 'optout.example', 'opt-out');
select makerkit.authenticate_as('au_a');
select is((select (inserted, duplicates)::text from public.lm_import_prospects((select space_a from t_au), '[
  {"name":"Local","site_key":"local.example","website":"file:///etc/passwd"},
  {"name":"Nu","site_key":"nu.example/","website":"nu.example"},
  {"name":"Opp","site_key":"optout.example","website":"https://optout.example"},
  {"name":"Doublon","site_key":"NU.example","website":"https://nu.example"}
]'::jsonb)), '(3,1)', 'Import : clés normalisées, doublon détecté');
set local role postgres;
select is((select website from public.lm_prospects where name = 'Local'), null, 'A5 : adresse file:// refusée');
select is((select website from public.lm_prospects where name = 'Nu'), 'https://nu.example', 'A5 : domaine nu complété en https://');
select is((select site_key from public.lm_prospects where name = 'Nu'), 'nu.example', 'A16 : clé sans / final');
select ok((select excluded_at is not null from public.lm_prospects where name = 'Opp'), 'A10 : site en opposition exclu d''office');
select throws_ok($$ update public.lm_prospects set website = 'javascript:alert(1)' where name = 'Un' $$,
  '23514', null, 'A5 : contrainte http(s) sur les sites');
select is(public.lm_clean_website('  https://ok.example/contact  '), 'https://ok.example/contact', 'lm_clean_website garde http(s)');
select is(public.lm_clean_website('ftp://x.example'), null, 'lm_clean_website refuse les autres protocoles');

-- La liste globale d'opposition n'est plus lisible par les clients
select makerkit.authenticate_as('au_a');
select is((select count(*)::int from public.lm_suppressions where account_id is null), 0, 'Liste globale invisible');

-- ── A11 / A12 : forfaits ─────────────────────────────────────────────────────────────────────────────────
set local role service_role;
select public.lm_reset_credits((select acc_a from t_au), 'growth', '2030-01-01'::timestamptz, 'sub:a:p1:growth');
set local role postgres;
update public.lm_account_credits set discovery_balance = 1000 where account_id = (select acc_a from t_au);
set local role service_role;
select public.lm_reset_credits((select acc_a from t_au), 'business', '2030-01-01'::timestamptz, 'sub:a:p1:business');
set local role postgres;
select is((select (plan_id, discovery_balance)::text from public.lm_account_credits where account_id = (select acc_a from t_au)),
  '(business,' || (1000 + (select discovery_credits from public.lm_plans where id = 'business')
                        - (select discovery_credits from public.lm_plans where id = 'growth'))::text || ')',
  'A11 : changement de forfait en cours de période = seulement la différence');
set local role service_role;
select public.lm_reset_credits((select acc_a from t_au), 'business', '2030-01-01'::timestamptz, 'sub:a:p1:business');
set local role postgres;
select is((select discovery_balance from public.lm_account_credits where account_id = (select acc_a from t_au)),
  1000 + (select discovery_credits from public.lm_plans where id = 'business')
       - (select discovery_credits from public.lm_plans where id = 'growth'),
  'Webhook rejoué : aucun crédit en plus');
select ok((select next_refill_at is not null from public.lm_account_credits where account_id = (select acc_a from t_au)),
  'A12 : période annuelle → recharge mensuelle programmée');

update public.lm_account_credits set discovery_balance = 5, next_refill_at = now() - interval '1 minute'
 where account_id = (select acc_a from t_au);
set local role service_role;
select ok(public.lm_refill_credits() >= 1, 'A12 : recharge mensuelle exécutée');
set local role postgres;
select is((select discovery_balance from public.lm_account_credits where account_id = (select acc_a from t_au)),
  (select discovery_credits from public.lm_plans where id = 'business'), 'A12 : crédits du mois rechargés');
select ok((select next_refill_at > now() + interval '27 days' from public.lm_account_credits where account_id = (select acc_a from t_au)),
  'A12 : recharge suivante dans un mois');

-- ── A2 : changer les filtres après le lancement fait re-mesurer le tarif ─────────────────────────────────
select makerkit.authenticate_as('au_a');
select public.lm_start_campaign('a0000000-0000-4000-8000-00000000a0a1');
set local role postgres;
update public.lm_campaigns set price_pending = false, credits_per_prospect = 1 where id = 'a0000000-0000-4000-8000-00000000a0a1';
create temp table t_est as select estimate_id from public.lm_campaigns where id = 'a0000000-0000-4000-8000-00000000a0a1';
select makerkit.authenticate_as('au_a');
select public.lm_update_campaign('a0000000-0000-4000-8000-00000000a0a1', 'Campagne A', 'ZX',
  '{"cities":{"mode":"list","geoname_ids":[990000701]},"categories":{"mode":"list","gcids":["gcid:au_one"]}}', '{}');
set local role postgres;
select is((select price_pending from public.lm_campaigns where id = 'a0000000-0000-4000-8000-00000000a0a1'), false,
  'Mêmes filtres : pas de nouvelle mesure');
select makerkit.authenticate_as('au_a');
select public.lm_update_campaign('a0000000-0000-4000-8000-00000000a0a1', 'Campagne A', 'ZX',
  '{"cities":{"mode":"list","geoname_ids":[990000701]},"categories":{"mode":"list","gcids":["gcid:au_one"]}}',
  '{"website":"with","rating_min":1,"rating_max":3.5}');
set local role postgres;
select ok((select price_pending and estimate_id is distinct from (select estimate_id from t_est)
             from public.lm_campaigns where id = 'a0000000-0000-4000-8000-00000000a0a1'),
  'A2 : filtres changés après lancement → nouvelle mesure du tarif');

-- ── A13 : un envoi confirmé à la main est débité une fois ────────────────────────────────────────────────
insert into public.lm_attempts (id, account_id, space_id, campaign_id, prospect_id, status, validated_at)
select 'a0000000-0000-4000-8000-00000000a7a1', acc_a, space_a, 'a0000000-0000-4000-8000-00000000a0a1',
       (select id from public.lm_prospects where name = 'Un'), 'to_verify', now() - interval '1 hour'
  from t_au;
create temp table t_bal as select outreach_balance from public.lm_account_credits where account_id = (select acc_a from t_au);
select makerkit.authenticate_as('au_a');
select is(public.lm_mark_attempts(array['a0000000-0000-4000-8000-00000000a7a1'::uuid], 'sent'), 1, 'Envoi confirmé');
set local role postgres;
select is((select outreach_balance from public.lm_account_credits where account_id = (select acc_a from t_au)),
  (select outreach_balance - 1 from t_bal), 'A13 : envoi confirmé à la main débité');

-- ── E18 : archiver une campagne ─────────────────────────────────────────────────────────────────────────
select makerkit.authenticate_as('au_b');
select throws_ok($$ select public.lm_set_campaign_archived('a0000000-0000-4000-8000-00000000a0a1', true) $$,
  'P0002', null, 'E18 : impossible d''archiver la campagne d''une autre organisation');
select makerkit.authenticate_as('au_a');
set local role postgres;
update public.lm_attempts set status = 'validated', validated_at = now() where id = 'a0000000-0000-4000-8000-00000000a7a1';
insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
select acc_a, 'send', jsonb_build_object('attempt_id', 'a0000000-0000-4000-8000-00000000a7a1'), 'send:audit-archive' from t_au;
select makerkit.authenticate_as('au_a');
select is(public.lm_set_campaign_archived('a0000000-0000-4000-8000-00000000a0a1', true), 'archived', 'E18 : campagne archivée');
set local role postgres;
select is((select status::text from public.lm_attempts where id = 'a0000000-0000-4000-8000-00000000a7a1'), 'ready',
  'E18 : formulaire validé retenu (repasse « prêt »)');
select is((select status::text from public.lm_tasks where idempotency_key = 'send:audit-archive'), 'cancelled',
  'E18 : envoi en attente annulé');
select makerkit.authenticate_as('au_a');
select throws_ok($$ select public.lm_start_campaign('a0000000-0000-4000-8000-00000000a0a1') $$,
  'P0001', 'campaign archived', 'E18 : une campagne archivée ne se relance pas');
select is(public.lm_set_campaign_archived('a0000000-0000-4000-8000-00000000a0a1', false), 'paused',
  'E18 : désarchivée, elle revient en pause');

-- ── E15 : sièges libres pour inviter ────────────────────────────────────────────────────────────────────
select makerkit.authenticate_as('au_a');
select is(public.lm_seats_available((select acc_a from t_au)),
  (select seats from public.lm_plans where id = 'business') - 1, 'E15 : sièges libres = forfait − membres');
set local role postgres;
insert into public.invitations (email, account_id, invited_by, role, invite_token)
select 'new@audit.test', acc_a, tests.get_supabase_uid('au_a'), 'member', 'audit-invite-token' from t_au;
select makerkit.authenticate_as('au_a');
select is(public.lm_seats_available((select acc_a from t_au)),
  (select seats from public.lm_plans where id = 'business') - 2, 'E15 : une invitation en attente occupe un siège');
select throws_ok($$ select public.lm_seats_available((select acc_b from t_au)) $$,
  'P0002', null, 'E15 : sièges d''une autre organisation illisibles');

select * from finish();

rollback;
