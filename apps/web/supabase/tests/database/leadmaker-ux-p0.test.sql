-- 11/11/2026 : analyse UX, problèmes graves réglés en base.
--  S-01 : petite campagne (recherche finie avant la mesure) : le prix est fixé sur ce qui a été trié.
--  S-02 : des gardées en attente de crédits sont réglées dès que des crédits arrivent (pack, recharge).
--  S-08 : le pilote attend les nouvelles gardées tant que la recherche tourne ; il reprend une entreprise payée
--         après le passage de son curseur (S-09).
--  E-01 / T-03 : lm_campaign_money (prix, crédits utilisés, crédits disponibles), réservé aux membres.
begin;

select no_plan();

select tests.create_supabase_user('ux_owner', 'ux_owner@test.com');
select tests.create_supabase_user('ux_other', 'ux_other@test.com');

set local role service_role;
select public.create_team_account('Ux A', tests.get_supabase_uid('ux_owner'), 'ux-a');
select public.create_team_account('Ux B', tests.get_supabase_uid('ux_other'), 'ux-b');
set local role postgres;

create temp view tux as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'ux-a';
grant select on tux to authenticated, service_role;

insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
update public.lm_discovery_settings set sort_measure_size = 5 where id;

insert into public.lm_account_credits (account_id, plan_id, discovery_balance, outreach_balance)
select account_id, 'growth', 100, 100 from tux
on conflict (account_id) do update set plan_id = 'growth', discovery_balance = 100, outreach_balance = 100;

insert into public.lm_sender_profiles (account_id, space_id, first_name, last_name, company, email, country_code)
select account_id, space_id, 'Laurie', 'Test', 'Agence', 'l@test.com', 'FR' from tux;

-- D : petite campagne ; D2 : petite campagne dont le dernier tri arrive après la fin de recherche ;
-- E : crédits épuisés ; F : pilote
insert into public.lm_campaigns (id, account_id, space_id, name, country_code, status, templates)
select x.id, t.account_id, t.space_id, x.name, 'FR', 'running',
       '{"messages":[{"name":"M1","subject":"Objet","body":"Bonjour {company}, ici {my_company}"}]}'::jsonb
  from tux t, (values ('e2000000-0000-4000-8000-0000000000d1'::uuid, 'Petite'),
                      ('e2000000-0000-4000-8000-0000000000d2'::uuid, 'Petite 2'),
                      ('e2000000-0000-4000-8000-0000000000e1'::uuid, 'Crédits'),
                      ('e2000000-0000-4000-8000-0000000000f1'::uuid, 'Pilote')) x(id, name);

create function pg_temp.bal() returns integer language sql as $$
  select public.lm_available_credits((select account_id from tux)) $$;
create function pg_temp.pid(p_key text) returns uuid language sql as $$
  select id from public.lm_prospects where site_key = p_key $$;
create function pg_temp.link(p_campaign uuid, p_key text) returns public.lm_campaign_prospects language sql as $$
  select * from public.lm_campaign_prospects where campaign_id = p_campaign and prospect_id = pg_temp.pid(p_key) $$;
create function pg_temp.camp(p_id uuid) returns public.lm_campaigns language sql as $$
  select * from public.lm_campaigns where id = p_id $$;
create function pg_temp.tour() returns integer language sql as $$
  update public.lm_autopilots set ticked_at = null;
  select public.lm_queue_sends();
$$;
grant execute on function pg_temp.bal(), pg_temp.pid(text), pg_temp.link(uuid, text), pg_temp.camp(uuid), pg_temp.tour()
  to authenticated, service_role;

set local role service_role;

select public.lm_start_sort(c, 'Agences')
  from unnest(array['e2000000-0000-4000-8000-0000000000d1', 'e2000000-0000-4000-8000-0000000000d2',
                    'e2000000-0000-4000-8000-0000000000e1', 'e2000000-0000-4000-8000-0000000000f1']::uuid[]) c;

-- S-01. Petite campagne : 3 entreprises triées (2 gardées), sous la mesure de 5
select public.lm_record_prospect('e2000000-0000-4000-8000-0000000000d1',
  format('{"place_id":"ux:%s","name":"Entreprise %s","site_key":"%s.fr","website":"https://%s.fr"}', n, n, n, n)::jsonb)
  from unnest(array['d1', 'd2', 'd3']) n;
select public.lm_finish_sort('e2000000-0000-4000-8000-0000000000d1', pg_temp.pid(n || '.fr'), 1, v, null, 'x')
  from (values ('d1', 'gardee'), ('d2', 'gardee'), ('d3', 'ecartee')) x(n, v);
select ok((pg_temp.camp('e2000000-0000-4000-8000-0000000000d1')).price_pending, 'S-01 : recherche en cours, prix toujours en mesure');
select is(pg_temp.bal(), 100, 'S-01 : rien de payé pendant la mesure');

set local role postgres;
update public.lm_campaigns set status = 'completed' where id = 'e2000000-0000-4000-8000-0000000000d1';
set local role service_role;
select is((select credits_per_prospect || ' / ' || price_pending from public.lm_campaigns where id = 'e2000000-0000-4000-8000-0000000000d1'),
  '1 / false', 'S-01 : recherche finie sous la mesure (moins de 50 triées) : 1 crédit, prix figé');
select is(pg_temp.bal(), 98, 'S-01 : les 2 gardées sont payées');
select ok((pg_temp.link('e2000000-0000-4000-8000-0000000000d1', 'd1.fr')).paid_at is not null, 'S-01 : gardée réglée, donc contactable');

-- S-01 bis : la recherche finit alors qu'une entreprise attend son tri : le prix attend ce dernier tri
select public.lm_record_prospect('e2000000-0000-4000-8000-0000000000d2',
  format('{"place_id":"ux:%s","name":"Entreprise %s","site_key":"%s.fr","website":"https://%s.fr"}', n, n, n, n)::jsonb)
  from unnest(array['g1', 'g2']) n;
select public.lm_finish_sort('e2000000-0000-4000-8000-0000000000d2', pg_temp.pid('g1.fr'), 1, 'gardee', null, 'x');
set local role postgres;
update public.lm_campaigns set status = 'completed' where id = 'e2000000-0000-4000-8000-0000000000d2';
set local role service_role;
select ok((pg_temp.camp('e2000000-0000-4000-8000-0000000000d2')).price_pending, 'S-01 : une entreprise encore à trier : prix en attente');
select public.lm_finish_sort('e2000000-0000-4000-8000-0000000000d2', pg_temp.pid('g2.fr'), 1, 'ecartee', null, 'x');
select is((select credits_per_prospect || ' / ' || price_pending from public.lm_campaigns where id = 'e2000000-0000-4000-8000-0000000000d2'),
  '1 / false', 'S-01 : dernier tri fait après la fin de recherche : prix figé');
select is(pg_temp.bal(), 97, 'S-01 : la gardée est payée');

-- S-01 ter : le prix d'une petite campagne est provisoire ; elle grandit (villes ajoutées) jusqu'à la mesure
-- complète : remesuré (1 gardée sur 5 = 20 % → 2 crédits), la gardée déjà payée le reste à 1 crédit
set local role postgres;
update public.lm_campaigns set status = 'running' where id = 'e2000000-0000-4000-8000-0000000000d2';
set local role service_role;
select public.lm_record_prospect('e2000000-0000-4000-8000-0000000000d2',
  format('{"place_id":"ux:%s","name":"Entreprise %s","site_key":"%s.fr","website":"https://%s.fr"}', n, n, n, n)::jsonb)
  from unnest(array['g3', 'g4', 'g5']) n;
select public.lm_finish_sort('e2000000-0000-4000-8000-0000000000d2', pg_temp.pid(n || '.fr'), 1, 'ecartee', null, 'x')
  from unnest(array['g3', 'g4', 'g5']) n;
select is((select credits_per_prospect || ' / ' || price_sample from public.lm_campaigns where id = 'e2000000-0000-4000-8000-0000000000d2'),
  '2 / 5', 'S-01 : campagne agrandie : prix remesuré sur la mesure complète');
select is((pg_temp.link('e2000000-0000-4000-8000-0000000000d2', 'g1.fr')).credits, 1, 'S-01 : la gardée déjà payée n''est pas redébitée');
select is(pg_temp.bal(), 97, 'S-01 : rien de plus débité');

-- S-02. Crédits épuisés : la gardée attend ; un pack acheté la règle sans autre action
set local role postgres;
update public.lm_campaigns set price_pending = false, credits_per_prospect = 2 where id = 'e2000000-0000-4000-8000-0000000000e1';
update public.lm_account_credits set discovery_balance = 1 where account_id = (select account_id from tux);
set local role service_role;
select public.lm_record_prospect('e2000000-0000-4000-8000-0000000000e1',
  '{"place_id":"ux:e1","name":"Entreprise e1","site_key":"e1.fr","website":"https://e1.fr"}');
select public.lm_finish_sort('e2000000-0000-4000-8000-0000000000e1', pg_temp.pid('e1.fr'), 1, 'gardee', null, 'ok');
select is((pg_temp.camp('e2000000-0000-4000-8000-0000000000e1')).filters ->> 'paused_reason', 'no_credits', 'S-02 : pause faute de crédits');
select ok((pg_temp.link('e2000000-0000-4000-8000-0000000000e1', 'e1.fr')).paid_at is null, 'S-02 : gardée en attente de crédits');
select is(public.lm_grant_credit_pack((select account_id from tux), 'pack_s', 10, 'ux-order-1'), true, 'S-02 : pack acheté');
select ok((pg_temp.link('e2000000-0000-4000-8000-0000000000e1', 'e1.fr')).paid_at is not null, 'S-02 : la gardée est réglée dès l''achat du pack');
select is(pg_temp.bal(), 9, 'S-02 : 2 crédits pris (1 du forfait, 1 du pack)');

-- S-02 bis : recharge du forfait (le solde monte) : réglée aussi ; un débit (le solde baisse) ne déclenche rien
-- (l'entreprise est trouvée avant la panne : à solde nul, la découverte s'arrête)
select is(public.lm_record_prospect('e2000000-0000-4000-8000-0000000000e1',
  '{"place_id":"ux:e2","name":"Entreprise e2","site_key":"e2.fr","website":"https://e2.fr"}'), 'kept', 'S-02 : entreprise trouvée');
set local role postgres;
update public.lm_account_credits set discovery_balance = 0 where account_id = (select account_id from tux);
update public.lm_credit_packs set remaining = 0 where account_id = (select account_id from tux);
set local role service_role;
select public.lm_finish_sort('e2000000-0000-4000-8000-0000000000e1', pg_temp.pid('e2.fr'), 1, 'gardee', null, 'ok');
select ok((pg_temp.link('e2000000-0000-4000-8000-0000000000e1', 'e2.fr')).paid_at is null, 'S-02 : nouvelle gardée en attente');
set local role postgres;
update public.lm_account_credits set discovery_balance = 50 where account_id = (select account_id from tux);
set local role service_role;
select ok((pg_temp.link('e2000000-0000-4000-8000-0000000000e1', 'e2.fr')).paid_at is not null, 'S-02 : réglée dès la recharge');
select is(pg_temp.bal(), 48, 'S-02 : 2 crédits débités une seule fois');
select is(public.lm_settle_account_kept((select account_id from tux)), 0, 'S-02 : plus rien en attente');

-- S-08. Pilote lancé pendant la recherche
set local role postgres;
update public.lm_campaigns set price_pending = false, credits_per_prospect = 1 where id = 'e2000000-0000-4000-8000-0000000000f1';
set local role service_role;
select public.lm_record_prospect('e2000000-0000-4000-8000-0000000000f1',
  format('{"place_id":"ux:%s","name":"Entreprise %s","site_key":"%s.fr","website":"https://%s.fr"}', n, n, n, n)::jsonb)
  from unnest(array['f1', 'f2']) n;
-- f1 trouvée avant f2 (l'horodatage est posé par un déclencheur, même instant dans la transaction)
set local role postgres;
alter table public.lm_prospects disable trigger lm_prospects_set_timestamps;
update public.lm_prospects set created_at = now() - interval '10 minutes' where site_key = 'f1.fr';
alter table public.lm_prospects enable trigger lm_prospects_set_timestamps;
set local role service_role;
select public.lm_finish_sort('e2000000-0000-4000-8000-0000000000f1', pg_temp.pid('f1.fr'), 1, 'a_verifier', null, 'x');
select public.lm_finish_sort('e2000000-0000-4000-8000-0000000000f1', pg_temp.pid('f2.fr'), 1, 'gardee', null, 'ok');

set local role postgres;
select makerkit.authenticate_as('ux_owner');
create temp table ux_ap as
  select public.lm_start_autopilot('e2000000-0000-4000-8000-0000000000f1', 5, array['M1'], 'continuous', 5, false) as id;
grant select on ux_ap to authenticated, service_role;
select is((select count(*)::int from public.lm_attempts where autopilot_id = (select id from ux_ap)), 1, 'S-08 : la seule gardée payée est prise');

set local role service_role;
select public.lm_finish_prepare((select id from public.lm_attempts where autopilot_id = (select id from ux_ap)), '{"status":"no_form"}'::jsonb);
select pg_temp.tour();
select is((select status::text from public.lm_autopilots where id = (select id from ux_ap)), 'running',
  'S-08 : rien à contacter mais la recherche tourne : le pilote attend au lieu de se terminer');

-- S-09 : f1 (trouvée avant f2, donc derrière le curseur) est gardée et payée après coup
set local role postgres;
select makerkit.authenticate_as('ux_owner');
select is(public.lm_choose_prospects('e2000000-0000-4000-8000-0000000000f1', array[pg_temp.pid('f1.fr')], 'gardee'), 1, 'S-09 : f1 gardée par le client');
set local role service_role;
select pg_temp.tour();
select pg_temp.tour();
select is((select count(*)::int from public.lm_attempts where autopilot_id = (select id from ux_ap) and prospect_id = pg_temp.pid('f1.fr')), 1,
  'S-09 : l''entreprise payée derrière le curseur est reprise');

-- Fin de la recherche, plus rien à trier ni à contacter : le pilote se termine
select public.lm_finish_prepare((select id from public.lm_attempts where prospect_id = pg_temp.pid('f1.fr')), '{"status":"no_form"}'::jsonb);
set local role postgres;
update public.lm_campaigns set status = 'completed' where id = 'e2000000-0000-4000-8000-0000000000f1';
set local role service_role;
select pg_temp.tour();
select pg_temp.tour();
select is((select status::text from public.lm_autopilots where id = (select id from ux_ap)), 'running',
  'S-08 : recherche finie mais tri encore actif il y a moins de 5 min : le pilote attend encore');
-- le dernier tri remonte à plus de 5 minutes (le temps ne passe pas dans la transaction)
set local role postgres;
update public.lm_campaign_prospects set sorted_at = now() - interval '10 minutes'
 where campaign_id = 'e2000000-0000-4000-8000-0000000000f1';
-- les tâches de tri sont faites (ici, aucun robot ne les a sorties de la file)
update public.lm_tasks set status = 'done', finished_at = now()
 where kind = 'sort' and payload ->> 'campaign_id' = 'e2000000-0000-4000-8000-0000000000f1';
set local role service_role;
select pg_temp.tour();
select is((select (status, finished_reason)::text from public.lm_autopilots where id = (select id from ux_ap)), '(done,no_prospects)',
  'S-08 : recherche finie et rien à contacter : pilote terminé');

-- E-01 / T-03. Argent de la campagne : membre seulement
set local role postgres;
select makerkit.authenticate_as('ux_owner');
select is((select (spent, available)::text from public.lm_campaign_money('e2000000-0000-4000-8000-0000000000d1')),
  '(2,46)', 'Argent de la campagne : prix, crédits utilisés, crédits disponibles (48 moins les 2 gardées du pilote)');
select makerkit.authenticate_as('ux_other');
select is((select count(*)::int from public.lm_campaign_money('e2000000-0000-4000-8000-0000000000d1')), 0,
  'Argent d''une campagne invisible pour une autre organisation');
select throws_ok($$ select public.lm_settle_account_kept((select id from public.accounts where slug = 'ux-a')) $$,
  '42501', null, 'Règlement des gardées réservé au rôle service');

select * from finish();

rollback;
