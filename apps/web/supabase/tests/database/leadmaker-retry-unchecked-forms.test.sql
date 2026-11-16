-- Filet de sécurité du contrôle IA (16/11/2026) : un formulaire « contrôle IA indisponible » est repréparé une seule
-- fois, une heure après, dans son pilote ; jamais un formulaire douteux, récent, d'une campagne archivée ou sans forfait.
begin;

select no_plan();

select tests.create_supabase_user('retry_owner', 'retry_owner@test.com');
select tests.create_supabase_user('retry_noplan', 'retry_noplan@test.com');

set local role service_role;
select public.create_team_account('Retry A', tests.get_supabase_uid('retry_owner'), 'retry-a');
select public.create_team_account('Retry B', tests.get_supabase_uid('retry_noplan'), 'retry-b');
set local role postgres;

insert into public.lm_account_credits (account_id, outreach_balance)
select id, 100 from public.accounts where slug = 'retry-a';

insert into public.lm_campaigns (account_id, space_id, name, country_code, templates)
select a.id, s.id, x.name, 'FR', '{"messages":[{"name":"M1","subject":"Objet","body":"Bonjour"}]}'::jsonb
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default,
       (values ('Camp'), ('Archivee')) as x(name)
 where a.slug = 'retry-a';
insert into public.lm_campaigns (account_id, space_id, name, country_code, templates)
select a.id, s.id, 'SansForfait', 'FR', '{"messages":[{"name":"M1","subject":"Objet","body":"Bonjour"}]}'::jsonb
  from public.accounts a join public.lm_spaces s on s.account_id = a.id and s.is_default where a.slug = 'retry-b';

insert into public.lm_autopilots (account_id, space_id, campaign_id, status, target, messages)
select account_id, space_id, id, 'running', 50, array['M1'] from public.lm_campaigns where name = 'Camp';

-- (nom, campagne, détail, il y a combien de temps)
insert into public.lm_prospects (account_id, space_id, campaign_id, name, site_key, website)
select c.account_id, c.space_id, c.id, x.name, x.name || '.fr', 'https://' || x.name || '.fr'
  from (values ('nonctrl', 'Camp'), ('recent', 'Camp'), ('douteux', 'Camp'), ('archive', 'Archivee'),
               ('noplan', 'SansForfait')) as x(name, camp)
  join public.lm_campaigns c on c.name = x.camp;

insert into public.lm_attempts (account_id, space_id, campaign_id, prospect_id, status, detail, autopilot_id, form_url,
                                filled, screenshot_before)
select p.account_id, p.space_id, p.campaign_id, p.id, 'ready', x.detail,
       case when p.name in ('nonctrl', 'recent', 'douteux') then (select id from public.lm_autopilots) end,
       'https://' || p.name || '.fr/contact', '{"email": "Email"}'::jsonb, 'capture.png'
  from public.lm_prospects p
  join (values
    ('nonctrl', 'à vérifier — contrôle IA indisponible, formulaire non contrôlé'),
    ('recent',  'à vérifier — contrôle IA indisponible, formulaire non contrôlé'),
    ('douteux', 'à vérifier — contrôle IA : formulaire de devis'),
    ('archive', 'à vérifier — contrôle IA indisponible, formulaire non contrôlé'),
    ('noplan',  'à vérifier — contrôle IA indisponible, formulaire non contrôlé')
  ) as x(name, detail) on x.name = p.name;

-- updated_at est posé par un déclencheur : vieilli après coup (sauf « recent »)
alter table public.lm_attempts disable trigger user;
update public.lm_attempts a set updated_at = now() - interval '2 hours'
  from public.lm_prospects p where p.id = a.prospect_id and p.name <> 'recent';
alter table public.lm_attempts enable trigger user;

update public.lm_campaigns set status = 'archived' where name = 'Archivee';

create function pg_temp.att(p_name text) returns uuid language sql as $$
  select a.id from public.lm_attempts a join public.lm_prospects p on p.id = a.prospect_id where p.name = p_name
$$;

-- Un utilisateur connecté ne peut pas l'appeler
select makerkit.authenticate_as('retry_owner');
select throws_ok($$ select public.lm_retry_unchecked_forms() $$, '42501', null, 'Refusé à un utilisateur connecté');

set local role service_role;
select is(public.lm_retry_unchecked_forms(), 1, 'Un seul formulaire repris');
set local role postgres;

select is((select status::text from public.lm_attempts where id = pg_temp.att('nonctrl')), 'pending', 'Non contrôlé : repréparé');
select is((select detail from public.lm_attempts where id = pg_temp.att('nonctrl')), null, 'Alerte effacée');
select is((select form_url from public.lm_attempts where id = pg_temp.att('nonctrl')), null, 'Ancienne capture et page effacées');
select isnt((select autopilot_id from public.lm_attempts where id = pg_temp.att('nonctrl')), null, 'Il reste dans son pilote');
select is((select count(*)::integer from public.lm_tasks
            where kind = 'prepare' and status = 'queued' and payload ->> 'attempt_id' = pg_temp.att('nonctrl')::text), 1,
  'Tâche de préparation en file');

select is((select status::text from public.lm_attempts where id = pg_temp.att('recent')), 'ready', 'Moins d''une heure : attend');
select is((select status::text from public.lm_attempts where id = pg_temp.att('douteux')), 'ready', 'Douteux : jamais repris');
select is((select status::text from public.lm_attempts where id = pg_temp.att('archive')), 'ready', 'Campagne archivée : jamais');
select is((select status::text from public.lm_attempts where id = pg_temp.att('noplan')), 'ready', 'Sans forfait : jamais');

-- L'IA est encore indisponible à la reprise : pas de seconde reprise
update public.lm_tasks set status = 'done' where payload ->> 'attempt_id' = pg_temp.att('nonctrl')::text;
alter table public.lm_attempts disable trigger user;
update public.lm_attempts set status = 'ready', detail = 'à vérifier — contrôle IA indisponible, formulaire non contrôlé',
       updated_at = now() - interval '2 hours'
 where id = pg_temp.att('nonctrl');
alter table public.lm_attempts enable trigger user;

set local role service_role;
select is(public.lm_retry_unchecked_forms(), 0, 'Jamais deux reprises pour le même formulaire');
select is(public.lm_retry_unchecked_forms(0), 0, 'Limite à 0 : rien');
set local role postgres;

select * from finish();

rollback;
