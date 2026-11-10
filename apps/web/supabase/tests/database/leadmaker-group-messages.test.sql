-- 10/11/2026 : « Un message par groupe » dans la même campagne (remplace « Créer N campagnes »). Chaque message
-- peut porter un groupe ; chaque entreprise reçoit un message de son groupe, sinon un message « Pour les autres ».
begin;

select no_plan();

select tests.create_supabase_user('gm_owner', 'gm_owner@test.com');
select tests.create_supabase_user('gm_other', 'gm_other@test.com');

set local role service_role;
select public.create_team_account('Gm A', tests.get_supabase_uid('gm_owner'), 'gm-a');
set local role postgres;

create temp view tgm as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'gm-a';
grant select on tgm to authenticated, service_role;

insert into public.lm_account_credits (account_id, plan_id, discovery_balance) select account_id, 'growth', 100 from tgm
on conflict (account_id) do update set plan_id = 'growth', discovery_balance = 100;
insert into public.lm_sender_profiles (account_id, space_id, first_name, last_name, company, email, country_code)
select account_id, space_id, 'Laurie', 'Test', 'Agence', 'l@test.com', 'FR' from tgm;

insert into public.lm_campaigns (id, account_id, space_id, name, country_code, status, sort_target, sort_version, sort_groups,
                                 price_pending, templates)
select 'e4000000-0000-4000-8000-0000000000a1'::uuid, account_id, space_id, 'Agences', 'FR', 'running', 'Agences', 1,
       '[{"key":"marketing","label":"Marketing"},{"key":"branding","label":"Branding"}]'::jsonb, false,
       '{"messages":[
          {"name":"Marketing A","group":"marketing","subject":"S","body":"Bonjour marketing"},
          {"name":"Marketing B","group":"marketing","subject":"S","body":"Salut marketing"},
          {"name":"Branding A","group":"branding","subject":"S","body":"Bonjour branding"},
          {"name":"Autres A","subject":"S","body":"Bonjour à tous"},
          {"name":"Vide","group":"branding","subject":"S","body":"  "}]}'::jsonb
  from tgm;

-- entreprises gardées et payées : 2 Marketing, 1 Branding, 1 « autre », 1 sans groupe
insert into public.lm_prospects (account_id, space_id, campaign_id, name, site_key, website, created_at)
select t.account_id, t.space_id, 'e4000000-0000-4000-8000-0000000000a1', x.n, x.n || '.fr', 'https://' || x.n || '.fr',
       now() - (10 - x.o) * interval '1 minute'
  from tgm t, (values ('m1', 1), ('m2', 2), ('b1', 3), ('x1', 4), ('s1', 5)) as x(n, o);
update public.lm_campaign_prospects cp
   set verdict = 'gardee', sorted_version = 1, paid_at = now(), credits = 1,
       group_key = case p.site_key when 'm1.fr' then 'marketing' when 'm2.fr' then 'marketing' when 'b1.fr' then 'branding'
                                   when 'x1.fr' then 'autre' end
  from public.lm_prospects p
 where p.id = cp.prospect_id and cp.campaign_id = 'e4000000-0000-4000-8000-0000000000a1';

set local role service_role;

-- 1. Sans choix (ou « Un seul message ») : les messages sans groupe d'abord
select is(public.lm_campaign_message_names('e4000000-0000-4000-8000-0000000000a1', 'marketing'), array['Autres A'],
  'Pas encore « Un message par groupe » : les messages sans groupe');

-- 2. « Un message par groupe » : choisi par le client
set local role postgres;
select makerkit.authenticate_as('gm_owner');
select lives_ok($$ select public.lm_set_groups_choice('e4000000-0000-4000-8000-0000000000a1', 'per_group') $$,
  'Le client choisit « Un message par groupe »');
select is((select distinct choice from public.lm_campaign_groups('e4000000-0000-4000-8000-0000000000a1')), 'per_group', 'Choix gardé');
select throws_ok($$ select public.lm_set_groups_choice('e4000000-0000-4000-8000-0000000000a1', 'n_importe') $$, 'P0001', null,
  'Choix inconnu refusé');
set local role service_role;

select is(public.lm_campaign_message_names('e4000000-0000-4000-8000-0000000000a1', 'marketing'), array['Marketing A', 'Marketing B'],
  'Groupe Marketing : ses deux versions');
select is(public.lm_campaign_message_names('e4000000-0000-4000-8000-0000000000a1', 'branding'), array['Branding A'],
  'Groupe Branding : sa version (la version vide est ignorée)');
select is(public.lm_campaign_message_names('e4000000-0000-4000-8000-0000000000a1', 'autre'), array['Autres A'],
  '« Autre » : le message « Pour les autres »');
select is(public.lm_campaign_message_names('e4000000-0000-4000-8000-0000000000a1', null), array['Autres A'],
  'Sans groupe : le message « Pour les autres »');

-- 3. Pilote automatique : chaque entreprise reçoit un message de son groupe
set local role postgres;
select makerkit.authenticate_as('gm_owner');
create temp table t_ap as
select public.lm_start_autopilot('e4000000-0000-4000-8000-0000000000a1', 5,
                                 array['Marketing A', 'Marketing B', 'Branding A', 'Autres A'], 'continuous', 5, false) as id;
grant select on t_ap to service_role;
set local role service_role;
select public.lm_autopilot_tick((select id from t_ap));

create temp view tgm_attempts as
select p.site_key, a.template_name from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id
 where a.campaign_id = 'e4000000-0000-4000-8000-0000000000a1';
grant select on tgm_attempts to service_role;

select is((select count(*)::integer from tgm_attempts), 5, 'Les 5 entreprises gardées sont mises en préparation');
select is((select string_agg(template_name, ',' order by template_name) from tgm_attempts where site_key in ('m1.fr', 'm2.fr')),
  'Marketing A,Marketing B', 'Marketing : ses deux versions, à tour de rôle');
select is((select template_name from tgm_attempts where site_key = 'b1.fr'), 'Branding A', 'Branding : son message');
select is((select template_name from tgm_attempts where site_key = 'x1.fr'), 'Autres A', '« Autre » : le message pour les autres');
select is((select template_name from tgm_attempts where site_key = 's1.fr'), 'Autres A', 'Sans groupe : le message pour les autres');

-- 4. Plus de 4 messages acceptés par le pilote (jusqu'à 24 : 4 versions × 6 onglets)
select ok((select pg_get_constraintdef(oid) like '%84%' from pg_constraint where conname = 'lm_autopilots_messages_not_empty'),
  'Jusqu''à 84 messages par pilote (4 versions × 21 onglets)');

-- 4 bis. Résultats par groupe : gardées, parties, à vérifier
set local role postgres;
update public.lm_attempts set status = 'sent' where prospect_id in (select id from public.lm_prospects where site_key in ('m1.fr', 'b1.fr'));
update public.lm_attempts set status = 'to_verify' where prospect_id = (select id from public.lm_prospects where site_key = 'm2.fr');
select makerkit.authenticate_as('gm_owner');
select is((select string_agg(coalesce(group_key, 'hors') || '=' || kept || '/' || sent || '/' || to_verify, ',' order by group_key nulls last)
             from public.lm_campaign_group_results('e4000000-0000-4000-8000-0000000000a1')),
  'branding=1/1/0,marketing=2/1/1,hors=2/0/0', 'Par groupe : gardées / parties / à vérifier (« autre » et sans groupe ensemble)');
select makerkit.authenticate_as('gm_other');
select is((select count(*)::integer from public.lm_campaign_group_results('e4000000-0000-4000-8000-0000000000a1')), 0,
  'Autre utilisateur : aucun chiffre');
set local role service_role;

-- 4 ter. Offre de la campagne, groupes fins
set local role postgres;
select makerkit.authenticate_as('gm_owner');
select lives_ok($$ select public.lm_set_campaign_offer('e4000000-0000-4000-8000-0000000000a1', '  Booster : du trafic garanti  ') $$,
  'Offre propre à la campagne');
select is((select offer from public.lm_campaigns where id = 'e4000000-0000-4000-8000-0000000000a1'), 'Booster : du trafic garanti', 'Offre enregistrée sans espaces');
select lives_ok($$ select public.lm_set_campaign_offer('e4000000-0000-4000-8000-0000000000a1', '') $$, 'Offre vidée');
select is((select offer from public.lm_campaigns where id = 'e4000000-0000-4000-8000-0000000000a1'), null, 'Vide = offre du dossier');
select makerkit.authenticate_as('gm_other');
select throws_ok($$ select public.lm_set_campaign_offer('e4000000-0000-4000-8000-0000000000a1', 'x') $$, 'P0002', null,
  'Autre utilisateur : offre refusée');
select throws_ok($$ update public.lm_campaigns set offer = 'x' $$, '42501', null, 'Client : offre non modifiable en direct');
set local role service_role;
insert into public.lm_campaigns (id, account_id, space_id, name, country_code, sort_target, sort_version)
select 'e4000000-0000-4000-8000-0000000000b2'::uuid, account_id, space_id, 'Fins', 'FR', 'Meubles', 1 from tgm;
select is(public.lm_set_sort_groups('e4000000-0000-4000-8000-0000000000b2', 1,
  (select jsonb_agg(jsonb_build_object('key', 'g' || n, 'label', 'Groupe ' || n)) from generate_series(1, 20) n)), 0,
  '20 groupes fins acceptés');
select throws_ok($$ select public.lm_set_sort_groups('e4000000-0000-4000-8000-0000000000b2', 1,
  (select jsonb_agg(jsonb_build_object('key', 'h' || n, 'label', 'H' || n)) from generate_series(1, 21) n)) $$, 'P0001', null,
  'Plus de 20 groupes refusés');

-- 5. Réservé : la liste des messages est lue par les robots, le choix seulement par un membre
set local role postgres;
select makerkit.authenticate_as('gm_owner');
select throws_ok($$ select public.lm_campaign_message_names('e4000000-0000-4000-8000-0000000000a1', 'marketing') $$, '42501', null,
  'Client : ne lit pas la liste des messages par cette fonction');
select makerkit.authenticate_as('gm_other');
select throws_ok($$ select public.lm_set_groups_choice('e4000000-0000-4000-8000-0000000000a1', 'per_group') $$, 'P0002', null,
  'Autre utilisateur : choix refusé');

select * from finish();

rollback;
