-- 9/11/2026 : annuaire commun, étape 1 (CDC-PARCOURS-TRI-ANNUAIRE.md §8.2). Toutes les fiches vues par une
-- recherche sont rangées dans lm_places et la recherche est notée dans lm_place_searches. Tables communes à
-- tous les clients : jamais lisibles par un client.
begin;

select no_plan();

select tests.create_supabase_user('pl_a', 'pl_a@test.com');

insert into public.lm_discovery_settings (id) values (true) on conflict (id) do nothing;
update public.lm_discovery_settings set chain_min = 3 where id;
insert into public.lm_categories (gcid, label_en, label_fr, family, is_generic, is_excluded) values
  ('gcid:pl_plumber', 'PL Plumber', 'PL Plombier', 'Test', false, false)
on conflict do nothing;

set local role service_role;

-- 1. Première recherche : 3 fiches, une ouverte (site sûr), une carte avec site, une liste compacte (site inconnu)
select is(
  public.lm_record_search_places(
    '{"country_code":"zz","gcid":"gcid:pl_plumber","geoname_id":42,"query":"PL Plumber in Testville","complete":true}',
    '[{"place_id":"pl:1","name":"Plomberie Un","category":"PL Plumber","rating":4.66,"review_count":12,
       "address":"1 rue A","phone":"+33 1 00 00 00 01","website":"https://un.example","site_key":"un.example",
       "website_known":true,"maps_url":"https://maps/1","latitude":45.1,"longitude":4.1,"city":"Testville",
       "geoname_id":42,"opened":true},
      {"place_id":"pl:2","name":"Plomberie Deux","category":"PL Plumber","rating":3.2,"review_count":5,
       "website":"deux.example","site_key":"deux.example","website_known":true,"city":"Testville","geoname_id":42},
      {"place_id":"pl:3","name":"Plomberie Trois","rating":4.0,"website":"","website_known":false},
      {"place_id":"pl:1","name":"Plomberie Un (doublon)","website_known":false},
      {"place_id":"","name":"Sans identifiant"},
      {"place_id":"pl:x","name":"  "}]'),
  3, 'Trois fiches rangées (doublon, fiche sans identifiant et sans nom ignorés)');

select is((select name from public.lm_places where google_place_id = 'pl:1'), 'Plomberie Un',
  'Doublon dans la même recherche : la fiche ouverte l''emporte');
select is((select gcid from public.lm_places where google_place_id = 'pl:1'), 'gcid:pl_plumber',
  'Catégorie retrouvée par son libellé');
select is((select rating from public.lm_places where google_place_id = 'pl:1'), 4.7::numeric(2,1), 'Note arrondie');
select ok((select details_at is not null from public.lm_places where google_place_id = 'pl:1'),
  'Fiche ouverte : date d''ouverture notée');
select is((select website from public.lm_places where google_place_id = 'pl:2'), 'https://deux.example',
  'Site nettoyé (https ajouté)');
select is((select country_code from public.lm_places where google_place_id = 'pl:2'), 'ZZ'::char(2), 'Pays en majuscules');
select ok((select not website_known and website is null and site_key is null from public.lm_places where google_place_id = 'pl:3'),
  'Liste compacte : site inconnu, pas « sans site »');

select is((select count(*)::integer from public.lm_place_searches where gcid = 'gcid:pl_plumber'), 1, 'Recherche notée au registre');
select is((select zone_key from public.lm_place_searches where gcid = 'gcid:pl_plumber'), '42', 'Zone d''une recherche par ville');
select is((select place_ids from public.lm_place_searches where gcid = 'gcid:pl_plumber'),
  array['pl:1', 'pl:2', 'pl:3', 'pl:1'], 'Fiches trouvées dans l''ordre de Google (sans les fiches inutilisables)');
select is((select cards from public.lm_place_searches where gcid = 'gcid:pl_plumber'), 6, 'Nombre de cartes lues');
select ok((select complete from public.lm_place_searches where gcid = 'gcid:pl_plumber'), 'Recherche complète');

-- 2. Deuxième passage (autre client, secteur d'une grande ville) : une carte moins riche n'efface rien
select is(
  public.lm_record_search_places(
    '{"country_code":"ZZ","gcid":"gcid:pl_plumber","geoname_id":42,"latitude":45.123456,"longitude":4.987654,"zoom":15,
      "campaign_id":"00000000-0000-0000-0000-000000000000"}',
    '[{"place_id":"pl:1","name":"Plomberie Un SARL","rating":4.8,"website_known":false},
      {"place_id":"pl:2","name":"Plomberie Deux","website":"","website_known":true},
      {"place_id":"pl:3","name":"Plomberie Trois","website":"https://trois.example","site_key":"trois.example","website_known":true}]'),
  3, 'Trois fiches mises à jour');

select ok((select name = 'Plomberie Un SARL' and rating = 4.8 and phone = '+33 1 00 00 00 01' and address = '1 rue A'
                  and website = 'https://un.example' and city = 'Testville' and latitude = 45.1
             from public.lm_places where google_place_id = 'pl:1'),
  'Infos nouvelles prises, infos absentes gardées (téléphone, adresse, site, ville, position)');
select ok((select website is null and site_key is null and website_known from public.lm_places where google_place_id = 'pl:2'),
  'On sait qu''elle n''a plus de site : le site est effacé');
select ok((select website = 'https://trois.example' and website_known from public.lm_places where google_place_id = 'pl:3'),
  'Site appris au deuxième passage');
select is((select zone_key from public.lm_place_searches where geoname_id = 42 and latitude is not null),
  '42@45.1235,4.9877,15', 'Zone d''un secteur : position arrondie');
select ok((select campaign_id is null and not complete from public.lm_place_searches where latitude is not null),
  'Campagne inconnue ignorée sans erreur, recherche incomplète par défaut');

-- 3. Fiches revues : plus « fermées »
update public.lm_places set closed_at = now() where google_place_id = 'pl:3';
select public.lm_record_search_places('{"country_code":"ZZ"}', '[{"place_id":"pl:3","name":"Plomberie Trois"}]');
select ok((select closed_at is null and website = 'https://trois.example' from public.lm_places where google_place_id = 'pl:3'),
  'Fiche revue : plus fermée, et une carte sans info de site ne l''efface pas');
select is((select count(*)::integer from public.lm_place_searches), 2, 'Sans activité, rien n''est noté au registre');

-- 4. Chaînes : même site sur chain_min fiches (3 ici)
select public.lm_record_search_places('{"country_code":"ZZ","gcid":"gcid:pl_plumber","geoname_id":43}',
  '[{"place_id":"ch:1","name":"Franchise A","website":"https://chaine.example","site_key":"chaine.example","website_known":true},
    {"place_id":"ch:2","name":"Franchise B","website":"https://chaine.example","site_key":"chaine.example","website_known":true}]');
select is((select count(*)::integer from public.lm_places where site_key = 'chaine.example' and is_chain), 0,
  'Deux fiches : pas encore une chaîne');
select public.lm_record_search_places('{"country_code":"ZZ","gcid":"gcid:pl_plumber","geoname_id":44}',
  '[{"place_id":"ch:3","name":"Franchise C","website":"https://chaine.example","site_key":"chaine.example","website_known":true}]');
select is((select count(*)::integer from public.lm_places where site_key = 'chaine.example' and is_chain), 3,
  'Trois fiches, toutes recherches confondues : chaîne');

-- 5. Entrées invalides : rien, sans erreur
select is(public.lm_record_search_places('{"country_code":"Z"}', '[{"place_id":"bad:1","name":"X"}]'), 0, 'Pays invalide');
select is(public.lm_record_search_places('{"country_code":"ZZ"}', '{"place_id":"bad:2"}'), 0, 'Liste invalide');

-- 6. Jamais accessible aux clients
set local role postgres;
select makerkit.authenticate_as('pl_a');

select throws_ok('select count(*) from public.lm_places', '42501', null, 'Client : annuaire illisible');
select throws_ok('select count(*) from public.lm_place_searches', '42501', null, 'Client : registre illisible');
select throws_ok(
  $$select public.lm_record_search_places('{"country_code":"ZZ"}', '[{"place_id":"evil","name":"X"}]')$$,
  '42501', null, 'Client : impossible d''écrire dans l''annuaire');
select throws_ok($$delete from public.lm_places$$, '42501', null, 'Client : impossible d''effacer l''annuaire');

set local role anon;
select throws_ok('select count(*) from public.lm_places', '42501', null, 'Anonyme : annuaire illisible');
select throws_ok(
  $$select public.lm_record_search_places('{"country_code":"ZZ"}', '[{"place_id":"evil","name":"X"}]')$$,
  '42501', null, 'Anonyme : impossible d''écrire dans l''annuaire');

set local role postgres;
select ok(not has_table_privilege('authenticated', 'public.lm_places', 'TRUNCATE')
          and not has_table_privilege('anon', 'public.lm_places', 'TRUNCATE')
          and not has_table_privilege('authenticated', 'public.lm_place_searches', 'TRUNCATE')
          and not has_table_privilege('anon', 'public.lm_place_searches', 'TRUNCATE'),
  'Aucun TRUNCATE pour les clients');

select * from finish();

rollback;
