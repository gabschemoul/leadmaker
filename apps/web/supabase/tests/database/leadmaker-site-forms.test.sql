-- Formulaires testés (12/11/2026) : chaque statut de tentative met à jour le constat du site (lm_site_forms),
-- un « sans formulaire » récent et fiable est retrouvé par le robot, illisible par les clients.
begin;

select no_plan();

select tests.create_supabase_user('sf_owner', 'sf_owner@test.com');

set local role service_role;
select public.create_team_account('SF A', tests.get_supabase_uid('sf_owner'), 'sf-a');
set local role postgres;

create temp view ta as select a.id as account_id, s.id as space_id
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'sf-a';

insert into public.lm_campaigns (account_id, space_id, name, country_code, templates)
select account_id, space_id, 'Camp', 'FR', '{"messages":[{"name":"M1","subject":"Objet","body":"Bonjour"}]}'::jsonb from ta;

insert into public.lm_prospects (account_id, space_id, campaign_id, name, site_key, website)
select t.account_id, t.space_id, (select id from public.lm_campaigns where name = 'Camp'), x.name, x.key, x.site
  from ta t, (values ('a', 'a.fr', 'https://a.fr'), ('b', 'b.fr', 'https://b.fr'), ('c', 'c.fr', 'https://c.fr'),
                     ('m', 'maps:123', null)) as x(name, key, site);

insert into public.lm_attempts (account_id, space_id, campaign_id, prospect_id, status)
select account_id, space_id, campaign_id, id, 'pending' from public.lm_prospects;

select is((select count(*)::int from public.lm_site_forms), 0, 'en attente : rien de retenu');

update public.lm_attempts a set status = 'no_form' from public.lm_prospects p where p.id = a.prospect_id and p.name = 'a';
update public.lm_attempts a set status = 'ready', form_url = 'https://b.fr/contact'
  from public.lm_prospects p where p.id = a.prospect_id and p.name = 'b';
update public.lm_attempts a set status = 'intervention_required', form_url = 'https://c.fr/contact'
  from public.lm_prospects p where p.id = a.prospect_id and p.name = 'c';
update public.lm_attempts a set status = 'no_form' from public.lm_prospects p where p.id = a.prospect_id and p.name = 'm';

select results_eq(
  'select site_key, status, form_url::text, source from public.lm_site_forms order by site_key',
  $$values ('a.fr', 'no_form', null::text, 'app'), ('b.fr', 'form', 'https://b.fr/contact', 'app'),
           ('c.fr', 'protected', 'https://c.fr/contact', 'app')$$,
  'statuts rangés par site, fiches sans site ignorées'
);

-- Envoyé : reste « form », l'adresse du formulaire est gardée, rien sur l'envoi
update public.lm_attempts a set status = 'sent' from public.lm_prospects p where p.id = a.prospect_id and p.name = 'b';
select is((select status || ' ' || form_url from public.lm_site_forms where site_key = 'b.fr'), 'form https://b.fr/contact',
          'envoyé rangé comme formulaire trouvé');

-- Constat fiable et récent : retrouvé ; trop ancien ou d'avant la date de confiance : non
update public.lm_site_forms set checked_at = now() - interval '1 hour' where site_key = 'a.fr';
update public.lm_discovery_settings set site_forms_trust_since = now() - interval '2 hours' where id;
select ok(public.lm_site_known_no_form('a.fr') is not null, 'sans formulaire récent : retrouvé');
select ok(public.lm_site_known_no_form('b.fr') is null, 'formulaire trouvé : à visiter');
update public.lm_discovery_settings set site_forms_trust_since = now() where id;
select ok(public.lm_site_known_no_form('a.fr') is null, 'constat d''avant la date de confiance : refait');
update public.lm_discovery_settings set site_forms_trust_since = '2020-01-01' where id;
update public.lm_site_forms set checked_at = now() - interval '200 days' where site_key = 'a.fr';
select ok(public.lm_site_known_no_form('a.fr') is null, 'constat trop ancien : refait');
update public.lm_site_forms set checked_at = now() - interval '1 hour', source = 'old_tool' where site_key = 'a.fr';
select ok(public.lm_site_known_no_form('a.fr') is null, 'constat de l''ancien outil : ne compte pas');

-- Un « sans formulaire » repris du constat ne le prolonge pas
update public.lm_site_forms set checked_at = now() - interval '3 days', source = 'app' where site_key = 'a.fr';
update public.lm_attempts a set status = 'pending' from public.lm_prospects p where p.id = a.prospect_id and p.name = 'a';
update public.lm_attempts a set status = 'no_form', detail = 'déjà vérifié le 09/11 : pas de formulaire de contact'
  from public.lm_prospects p where p.id = a.prospect_id and p.name = 'a';
select ok((select checked_at < now() - interval '2 days' from public.lm_site_forms where site_key = 'a.fr'),
          'constat repris : date inchangée');

-- Clients : aucun accès
select makerkit.authenticate_as('sf_owner');
select throws_ok('select count(*) from public.lm_site_forms', '42501', null, 'table illisible pour un client');
select throws_ok($$select public.lm_site_known_no_form('a.fr')$$, '42501', null, 'fonction interdite à un client');

select * from finish();
rollback;
