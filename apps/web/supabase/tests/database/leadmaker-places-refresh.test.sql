-- 10/11/2026 : annuaire commun, étape 3 (CDC-PARCOURS-TRI-ANNUAIRE §8.5). Signes de mort : « fermé
-- définitivement » sur la carte, fiche absente de 2 nouvelles recherches complètes de sa zone, site mort vu par la
-- préparation. Une fiche fermée ou au site mort n'est plus proposée par la reprise ; elle revient dès qu'elle est revue.
begin;

select no_plan();

insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
update public.lm_discovery_settings set places_missed_to_close = 2, places_max_age_days = 90 where id;
insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded) values
  ('gcid:rf_baker', 'RF Baker', 'RF Boulanger', 'Test', false, false)
on conflict do nothing;

create function pg_temp.search(p_ids text[], p_complete boolean, p_ended boolean, p_closed text[] default '{}')
returns integer language sql as $$
  select public.lm_record_search_places(
    jsonb_build_object('country_code', 'ZZ', 'gcid', 'gcid:rf_baker', 'geoname_id', 7, 'complete', p_complete, 'ended', p_ended),
    (select jsonb_agg(jsonb_build_object('place_id', i, 'name', 'Boulangerie ' || i, 'closed', i = any (p_closed)) order by o)
       from unnest(p_ids) with ordinality as u(i, o)));
$$;
grant execute on function pg_temp.search(text[], boolean, boolean, text[]) to service_role;

create function pg_temp.place(p_id text) returns public.lm_places language sql as $$
  select * from public.lm_places where google_place_id = p_id $$;
grant execute on function pg_temp.place(text) to service_role;

create function pg_temp.age_all() returns void language sql as $$
  update public.lm_places set last_seen_at = now() - interval '100 days' where google_place_id like 'rf:%';
  update public.lm_place_searches set searched_at = searched_at - interval '100 days' where gcid = 'gcid:rf_baker';
$$;

set local role service_role;

-- 1. « Fermé définitivement » sur la carte : rangée mais fermée, plus proposée
select is(pg_temp.search(array['rf:a', 'rf:b', 'rf:c', 'rf:x'], true, true, array['rf:x']), 4, 'Quatre fiches rangées');
select ok((pg_temp.place('rf:x')).closed_at is not null, 'Carte « fermé définitivement » : fermée');
select ok((pg_temp.place('rf:a')).closed_at is null, 'Les autres : ouvertes');
select ok(not (public.lm_replay_search('ZZ', 'gcid:rf_baker', 7, null, null, null) -> 'places') @> '[{"place_id":"rf:x"}]',
  'Fiche fermée : pas dans la reprise');
select is(jsonb_array_length(public.lm_replay_search('ZZ', 'gcid:rf_baker', 7, null, null, null) -> 'places'), 3,
  'Reprise : les trois ouvertes');

-- 2. Fiche absente d'une recherche lue jusqu'au bout : une absence ; de deux : fermée
set local role postgres;
select pg_temp.age_all();
set local role service_role;

-- Recherche fondue de plus de moitié par rapport à la précédente (page mal chargée) : ne compte pas
select pg_temp.search(array['rf:a'], true, true);
select is((pg_temp.place('rf:c')).missed_searches, 0::smallint, 'Recherche fondue de moitié : rien ne compte');

select pg_temp.search(array['rf:a', 'rf:b'], true, true);
select is((pg_temp.place('rf:c')).missed_searches, 1::smallint, 'Absente une fois : une absence');
select ok((pg_temp.place('rf:c')).closed_at is null, 'Une absence : pas encore fermée');
select is((pg_temp.place('rf:a')).missed_searches, 0::smallint, 'Revue : aucune absence');

-- Recherche pas lue jusqu'au bout (120 fiches, liste coupée) ou incomplète : ne compte pas
select pg_temp.search(array['rf:a', 'rf:b'], true, false);
select pg_temp.search(array['rf:a', 'rf:b'], false, true);
select is((pg_temp.place('rf:c')).missed_searches, 1::smallint, 'Liste coupée ou recherche incomplète : rien ne compte');

select pg_temp.search(array['rf:a', 'rf:b'], true, true);
select is((pg_temp.place('rf:c')).missed_searches, 2::smallint, 'Absente deux fois : deux absences');
select ok((pg_temp.place('rf:c')).closed_at is not null, 'Deux absences : fermée');
select ok(not (public.lm_replay_search('ZZ', 'gcid:rf_baker', 7, null, null, null) -> 'places') @> '[{"place_id":"rf:c"}]',
  'Fermée : plus dans la reprise');

-- 3. Revue dans une recherche : rouverte, compteur remis à zéro ; une carte encore « fermée » reste fermée
select pg_temp.search(array['rf:a', 'rf:b', 'rf:c', 'rf:x'], true, true, array['rf:x']);
select ok((pg_temp.place('rf:c')).closed_at is null and (pg_temp.place('rf:c')).missed_searches = 0,
  'Revue : rouverte, plus d''absence');
select ok((pg_temp.place('rf:x')).closed_at is not null, 'Toujours affichée fermée : reste fermée');
select pg_temp.search(array['rf:x'], false, false);
select ok((pg_temp.place('rf:x')).closed_at is null, 'Revue sans « fermé » : rouverte');

-- 4. Vue récemment par une autre recherche : son absence ici ne compte pas
set local role postgres;
select pg_temp.age_all();
update public.lm_places set last_seen_at = now() - interval '2 days' where google_place_id = 'rf:b';
set local role service_role;
select pg_temp.search(array['rf:a', 'rf:c', 'rf:x'], true, true);
select is((pg_temp.place('rf:b')).missed_searches, 0::smallint, 'Vue ailleurs il y a 2 jours : absence non comptée');

-- 5. Site mort vu par la préparation : noté, plus proposé ; relu sans souci par le tri : de nouveau proposé
set local role postgres;
select tests.create_supabase_user('rf_owner', 'rf_owner@test.com');
select public.create_team_account('Rf A', tests.get_supabase_uid('rf_owner'), 'rf-a');
set local role postgres;
insert into public.lm_campaigns (id, account_id, space_id, name, country_code)
select 'e7000000-0000-4000-8000-0000000000a1'::uuid, a.id, s.id, 'Boulangeries', 'FR'
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'rf-a';
insert into public.lm_account_credits (account_id, discovery_balance)
select account_id, 100 from public.lm_campaigns where id = 'e7000000-0000-4000-8000-0000000000a1'
on conflict (account_id) do update set discovery_balance = 100;
set local role service_role;
select public.lm_record_prospect('e7000000-0000-4000-8000-0000000000a1',
  '{"place_id":"rf:a","name":"Boulangerie rf:a","site_key":"rfa.fr","website":"https://rfa.fr"}');
-- une seule tentative par entreprise et par espace : la précédente est retirée
create function pg_temp.attempt() returns uuid language sql as $$
  delete from public.lm_attempts where prospect_id = (select id from public.lm_prospects where site_key = 'rfa.fr');
  insert into public.lm_attempts (account_id, space_id, campaign_id, prospect_id, status)
  select p.account_id, p.space_id, p.campaign_id, p.id, 'preparing' from public.lm_prospects p where p.site_key = 'rfa.fr'
  returning id $$;
grant execute on function pg_temp.attempt() to service_role;

select ok(public.lm_finish_prepare(pg_temp.attempt(),
  '{"status":"unreachable","detail":"site hors ligne"}'), 'Site injoignable sans plus');
select ok((pg_temp.place('rf:a')).site_dead_at is null, 'Injoignable (peut-être passager) : pas noté mort');

select ok(public.lm_finish_prepare(pg_temp.attempt(),
  '{"status":"unreachable","detail":"site hors ligne (« domain for sale »)","site_dead":true}'), 'Site mort');
select ok((pg_temp.place('rf:a')).site_dead_at is not null and (pg_temp.place('rf:a')).site_status = 'unreachable',
  'Site mort : noté dans l''annuaire, lu comme injoignable par le tri');
select ok(not (public.lm_replay_search('ZZ', 'gcid:rf_baker', 7, null, null, null) -> 'places') @> '[{"place_id":"rf:a"}]',
  'Site mort : plus dans la reprise');

set local role postgres;
update public.lm_places set site_dead_at = now() - interval '91 days' where google_place_id = 'rf:a';
set local role service_role;
select ok((public.lm_replay_search('ZZ', 'gcid:rf_baker', 7, null, null, null) -> 'places') @> '[{"place_id":"rf:a"}]',
  'Constat de plus de 90 jours : de nouveau proposée');

set local role postgres;
update public.lm_places set site_dead_at = now() where google_place_id = 'rf:a';
set local role service_role;
select public.lm_start_sort('e7000000-0000-4000-8000-0000000000a1', 'Boulangeries artisanales');
select public.lm_finish_sort('e7000000-0000-4000-8000-0000000000a1', (select id from public.lm_prospects where site_key = 'rfa.fr'),
  1, 'gardee', null, 'Boulangerie', 'ok', 'Pains au levain');
select ok((pg_temp.place('rf:a')).site_dead_at is null, 'Site relu sans souci par le tri : plus mort');

-- 6. Jamais accessible aux clients
set local role postgres;
select makerkit.authenticate_as('rf_owner');
select throws_ok('select missed_searches from public.lm_places', '42501', null, 'Client : annuaire illisible');

select * from finish();

rollback;
