-- 9/11/2026 : crédit unique (CDC-PARCOURS-TRI-ANNUAIRE §5, étape 4). Campagne avec une cible en mots : rien n'est
-- débité à la découverte ; le prix d'une entreprise gardée est mesuré sur les premières entreprises triées puis
-- figé ; depuis le 11/11 les gardées sont payées tout de suite (1 crédit pendant la mesure) ; jamais deux fois par équipe ;
-- sous 6 % de gardées la campagne se met en pause ; les envois ne débitent plus rien.
begin;

select no_plan();

select tests.create_supabase_user('sc_owner', 'sc_owner@test.com');

set local role service_role;
select public.create_team_account('Sc A', tests.get_supabase_uid('sc_owner'), 'sc-a');
set local role postgres;

create temp view tsc as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'sc-a';
grant select on tsc to authenticated, service_role;

insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
update public.lm_discovery_settings set sort_measure_size = 5, sort_abandon_after = 3, sort_abandon_rate = 0.5 where id;
insert into public.lm_categories (gcid, label_en, label_fr, family) values
  ('gcid:sc_agency', 'SC agency', 'SC agence', 'Test'), ('gcid:sc_bakery', 'SC bakery', 'SC boulangerie', 'Test')
on conflict do nothing;

insert into public.lm_account_credits (account_id, plan_id, discovery_balance) select account_id, 'growth', 100 from tsc
on conflict (account_id) do update set plan_id = 'growth', discovery_balance = 100;

-- A : campagne sans cible (ancien modèle) ; B : campagne triée ; C : campagne triée qui sera trop difficile
insert into public.lm_campaigns (id, account_id, space_id, name, country_code, status)
select x.id, t.account_id, t.space_id, x.name, 'FR', 'running'
  from tsc t, (values ('e1000000-0000-4000-8000-0000000000a1'::uuid, 'Sans cible'),
                      ('e1000000-0000-4000-8000-0000000000b1'::uuid, 'Triée'),
                      ('e1000000-0000-4000-8000-0000000000c1'::uuid, 'Trop dure')) x(id, name);
insert into public.lm_campaign_categories (campaign_id, gcid, account_id)
select c.id, g.gcid, c.account_id from public.lm_campaigns c, (values ('gcid:sc_agency'), ('gcid:sc_bakery')) g(gcid)
 where c.id in ('e1000000-0000-4000-8000-0000000000b1', 'e1000000-0000-4000-8000-0000000000c1');

create function pg_temp.bal() returns integer language sql as $$
  select discovery_balance from public.lm_account_credits where account_id = (select account_id from tsc) $$;
create function pg_temp.pid(p_key text) returns uuid language sql as $$
  select id from public.lm_prospects where site_key = p_key $$;
create function pg_temp.link(p_campaign uuid, p_key text) returns public.lm_campaign_prospects language sql as $$
  select * from public.lm_campaign_prospects where campaign_id = p_campaign and prospect_id = pg_temp.pid(p_key) $$;
grant execute on function pg_temp.bal(), pg_temp.pid(text), pg_temp.link(uuid, text) to service_role;

set local role service_role;

-- 1. Sans cible : débit à l'enregistrement, comme avant (prise de contact comprise)
select is(public.lm_record_prospect('e1000000-0000-4000-8000-0000000000a1',
  '{"place_id":"sc:a","name":"Déjà payée","site_key":"deja.fr","website":"https://deja.fr","gcid":"gcid:sc_agency"}'), 'kept', 'Sans cible : gardée');
select is(pg_temp.bal(), 99, 'Sans cible : 1 crédit débité tout de suite');
select ok((pg_temp.link('e1000000-0000-4000-8000-0000000000a1', 'deja.fr')).paid_at is not null, 'Sans cible : réglée');

-- 2. Campagne triée : rien à la découverte, prix en attente
select is(public.lm_start_sort('e1000000-0000-4000-8000-0000000000b1', 'Agences'), 0, 'Cible posée');
select ok((select price_pending from public.lm_campaigns where id = 'e1000000-0000-4000-8000-0000000000b1'), 'Prix en attente de mesure');
select public.lm_record_prospect('e1000000-0000-4000-8000-0000000000b1',
  format('{"place_id":"sc:%s","name":"Entreprise %s","site_key":"%s.fr","website":"https://%s.fr","gcid":"gcid:sc_agency"}', n, n, n, n)::jsonb)
  from unnest(array['b1', 'b2', 'b3', 'b4', 'b5', 'b6']) n;
select is(pg_temp.bal(), 99, 'Triée : rien débité à la découverte');
select is((pg_temp.link('e1000000-0000-4000-8000-0000000000b1', 'b1.fr')).gcid, 'gcid:sc_agency', 'Activité notée sur le lien');
-- l'entreprise déjà payée par l'équipe (campagne A) retrouvée par B : liée, réglée sans débit
select is(public.lm_record_prospect('e1000000-0000-4000-8000-0000000000b1',
  '{"place_id":"sc:a","name":"Déjà payée","site_key":"deja.fr","website":"https://deja.fr","gcid":"gcid:sc_agency"}'), 'duplicate', 'Déjà dans l''espace');

-- 3. Mesure sur 5 triées : 1 gardée sur 5 (20 %) → 2 crédits ; la gardée de la mesure payée tout de suite (1 crédit)
select public.lm_finish_sort('e1000000-0000-4000-8000-0000000000b1', pg_temp.pid('b1.fr'), 1, 'gardee', null, 'ok');
select is(pg_temp.bal(), 98, 'Gardée pendant la mesure : payée tout de suite, 1 crédit (choix du 11/11)');
select ok((pg_temp.link('e1000000-0000-4000-8000-0000000000b1', 'b1.fr')).paid_at is not null, 'Gardée payée, donc contactable tout de suite');
select public.lm_finish_sort('e1000000-0000-4000-8000-0000000000b1', pg_temp.pid(n || '.fr'), 1, v, null, 'x')
  from (values ('b2', 'ecartee'), ('b3', 'a_verifier'), ('b4', 'ecartee')) x(n, v);
select ok((select price_pending from public.lm_campaigns where id = 'e1000000-0000-4000-8000-0000000000b1'), '4 triées : toujours en mesure');
select public.lm_finish_sort('e1000000-0000-4000-8000-0000000000b1', pg_temp.pid('b5.fr'), 1, 'ecartee', null, 'x');
select is((select credits_per_prospect || ' / ' || price_pending from public.lm_campaigns where id = 'e1000000-0000-4000-8000-0000000000b1'),
  '2 / false', '5 triées, 20 % gardées : 2 crédits par entreprise gardée, prix figé');
select is(pg_temp.bal(), 98, 'Prix mesuré : la gardée déjà payée n''est pas redébitée');
select is((pg_temp.link('e1000000-0000-4000-8000-0000000000b1', 'b1.fr')).credits, 1, 'Crédits notés sur le lien (tarif du moment)');

-- 4. Après la mesure : payée dès qu'elle est gardée ; écartée et à vérifier : gratuites
select public.lm_finish_sort('e1000000-0000-4000-8000-0000000000b1', pg_temp.pid('b6.fr'), 1, 'gardee', null, 'ok');
select is(pg_temp.bal(), 96, 'Gardée après la mesure : 2 crédits tout de suite');
select ok((pg_temp.link('e1000000-0000-4000-8000-0000000000b1', 'b2.fr')).paid_at is null
          and (pg_temp.link('e1000000-0000-4000-8000-0000000000b1', 'b3.fr')).paid_at is null, 'Écartée et à vérifier : rien de payé');

-- 5. Jamais deux fois : déjà payée par l'équipe, gardée dans B sans débit
select public.lm_finish_sort('e1000000-0000-4000-8000-0000000000b1', pg_temp.pid('deja.fr'), 1, 'gardee', null, 'ok');
select is(pg_temp.bal(), 96, 'Déjà payée par l''équipe : pas redébitée');
select is((pg_temp.link('e1000000-0000-4000-8000-0000000000b1', 'deja.fr')).credits, 0, 'Lien à 0 crédit');
select is(public.lm_settle_kept('e1000000-0000-4000-8000-0000000000b1'), 0, 'Rien d''autre à régler');

-- 6. Crédits épuisés : pause, la gardée attend ; recharge : réglée
set local role postgres;
update public.lm_account_credits set discovery_balance = 1 where account_id = (select account_id from tsc);
set local role service_role;
select public.lm_record_prospect('e1000000-0000-4000-8000-0000000000b1',
  '{"place_id":"sc:b7","name":"Entreprise b7","site_key":"b7.fr","website":"https://b7.fr","gcid":"gcid:sc_agency"}');
select public.lm_finish_sort('e1000000-0000-4000-8000-0000000000b1', pg_temp.pid('b7.fr'), 1, 'gardee', null, 'ok');
select is((select status::text || ' / ' || (filters ->> 'paused_reason') from public.lm_campaigns where id = 'e1000000-0000-4000-8000-0000000000b1'),
  'paused / no_credits', 'Pas assez de crédits : campagne en pause');
select ok((pg_temp.link('e1000000-0000-4000-8000-0000000000b1', 'b7.fr')).paid_at is null and pg_temp.bal() = 1, 'Gardée en attente, solde intact');
set local role postgres;
update public.lm_account_credits set discovery_balance = 10 where account_id = (select account_id from tsc);
set local role service_role;
-- analyse UX S-02 (11/11/2026) : la recharge règle d'elle-même les gardées en attente
select ok((pg_temp.link('e1000000-0000-4000-8000-0000000000b1', 'b7.fr')).paid_at is not null, 'Après recharge : réglée tout de suite');
select is(public.lm_settle_kept('e1000000-0000-4000-8000-0000000000b1'), 0, 'Plus rien à régler');
select is(pg_temp.bal(), 8, '2 crédits débités');
-- plus de crédit du tout : la découverte s'arrête aussi
set local role postgres;
update public.lm_account_credits set discovery_balance = 0 where account_id = (select account_id from tsc);
update public.lm_campaigns set status = 'running' where id = 'e1000000-0000-4000-8000-0000000000b1';
set local role service_role;
select is(public.lm_record_prospect('e1000000-0000-4000-8000-0000000000b1',
  '{"place_id":"sc:b8","name":"Entreprise b8","site_key":"b8.fr","website":"https://b8.fr"}'), 'no_credits', 'Solde à zéro : découverte arrêtée');
set local role postgres;
update public.lm_account_credits set discovery_balance = 100 where account_id = (select account_id from tsc);
set local role service_role;

-- 7. Trop difficile : moins de 6 % de gardées → pause « too_hard », rien de payé ; activité abandonnée
select public.lm_start_sort('e1000000-0000-4000-8000-0000000000c1', 'Licornes');
select public.lm_record_prospect('e1000000-0000-4000-8000-0000000000c1',
  format('{"place_id":"sc:%s","name":"Boulangerie %s","site_key":"%s.fr","website":"https://%s.fr","gcid":"gcid:sc_bakery"}', n, n, n, n)::jsonb)
  from unnest(array['c1', 'c2', 'c3', 'c4', 'c5']) n;
select public.lm_finish_sort('e1000000-0000-4000-8000-0000000000c1', pg_temp.pid(n || '.fr'), 1, 'ecartee', null, 'hors cible')
  from unnest(array['c1', 'c2', 'c3', 'c4', 'c5']) n;
select is((select status::text || ' / ' || (filters ->> 'paused_reason') || ' / ' || price_pending from public.lm_campaigns
            where id = 'e1000000-0000-4000-8000-0000000000c1'), 'paused / too_hard / true', 'Moins de 6 % : pause « trop difficile »');
select is((select sorted || ' / ' || sorted_kept || ' / ' || abandoned from public.lm_campaign_categories
            where campaign_id = 'e1000000-0000-4000-8000-0000000000c1' and gcid = 'gcid:sc_bakery'),
  '5 / 0 / false', 'Activité qui ne donne rien de gardé : continue (plus d''abandon depuis le 11/11/2026)');
select is(pg_temp.bal(), 100, 'Trop difficile : rien de payé');

-- 8. Nouvelle cible : compteurs remis à zéro, prix de nouveau en attente
select public.lm_start_sort('e1000000-0000-4000-8000-0000000000b1', 'Agences de branding');
select is((select price_pending::text from public.lm_campaigns where id = 'e1000000-0000-4000-8000-0000000000b1'), 'true', 'Nouvelle cible : prix remesuré');
select is((select sorted from public.lm_campaign_categories where campaign_id = 'e1000000-0000-4000-8000-0000000000b1' and gcid = 'gcid:sc_agency'),
  0, 'Nouvelle cible : compteurs du tri remis à zéro');

-- 9. Envois : illimités avec un forfait, aucun sans
select is(public.lm_outreach_balance((select account_id from tsc)), 1000000000, 'Avec forfait : envois illimités');
select is(public.lm_outreach_balance(extensions.uuid_generate_v4()), 0, 'Sans forfait : aucun envoi');

-- 10. Réservé aux robots
set local role postgres;
select makerkit.authenticate_as('sc_owner');
select throws_ok($$ select public.lm_settle_kept('e1000000-0000-4000-8000-0000000000b1') $$, '42501', null, 'Client : ne règle rien lui-même');
select throws_ok($$ select public.lm_measure_sort_price('e1000000-0000-4000-8000-0000000000b1') $$, '42501', null, 'Client : ne fixe pas son prix');
select throws_ok($$ select public.lm_outreach_balance((select account_id from tsc)) $$, '42501', null, 'Client : fonction interne');
select throws_ok($$ update public.lm_campaign_prospects set paid_at = now() $$, '42501', null, 'Client : ne marque rien comme payé');

select * from finish();

rollback;
