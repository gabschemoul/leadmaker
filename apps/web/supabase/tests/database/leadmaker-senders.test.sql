-- 3/11/2026 : plusieurs expéditeurs par organisation, un par défaut, et un expéditeur au choix par campagne.
begin;

select no_plan();

select tests.create_supabase_user('snd_a', 'snd_a@test.com');
select tests.create_supabase_user('snd_b', 'snd_b@test.com');

set local role service_role;
select public.create_team_account('Snd A', tests.get_supabase_uid('snd_a'), 'snd-a');
select public.create_team_account('Snd B', tests.get_supabase_uid('snd_b'), 'snd-b');
set local role postgres;

create temp table t_ids as
  select (select id from public.accounts where slug = 'snd-a') as acc_a,
         (select id from public.accounts where slug = 'snd-b') as acc_b,
         (select s.id from public.lm_spaces s join public.accounts a on a.id = s.account_id
           where a.slug = 'snd-a' and s.is_default) as space_a,
         (select s.id from public.lm_spaces s join public.accounts a on a.id = s.account_id
           where a.slug = 'snd-b' and s.is_default) as space_b;
grant select on t_ids to authenticated, service_role;

-- Organisation A : trois expéditeurs ; le premier est celui par défaut, même si les suivants le demandent
select makerkit.authenticate_as('snd_a');

insert into public.lm_sender_profiles (account_id, space_id, first_name, last_name, company, email, country_code)
select acc_a, space_a, 'Alice', 'Un', 'Société Un', 'un@a.test', 'FR' from t_ids;
insert into public.lm_sender_profiles (account_id, space_id, first_name, last_name, company, email, country_code, is_default)
select acc_a, space_a, 'Bruno', 'Deux', 'Société Deux', 'deux@a.test', 'FR', true from t_ids;
insert into public.lm_sender_profiles (account_id, space_id, first_name, last_name, company, email, country_code)
select acc_a, space_a, 'Chloé', 'Trois', 'Société Trois', 'trois@a.test', 'FR' from t_ids;

select is((select count(*)::int from public.lm_sender_profiles where space_id = (select space_a from t_ids)), 3,
  'Plusieurs expéditeurs dans la même organisation');
select is((select string_agg(first_name, ',' order by first_name) from public.lm_sender_profiles
            where space_id = (select space_a from t_ids) and is_default), 'Alice',
  'Le premier expéditeur est celui par défaut, un seul par défaut');

select throws_ok(
  $$ update public.lm_sender_profiles set is_default = true where first_name = 'Bruno' $$,
  '42501', null, 'Le choix du défaut ne passe que par lm_set_default_sender');

select lives_ok(
  $$ select public.lm_set_default_sender((select id from public.lm_sender_profiles where first_name = 'Bruno')) $$,
  'Un membre choisit l''expéditeur par défaut');
select is((select string_agg(first_name, ',') from public.lm_sender_profiles
            where space_id = (select space_a from t_ids) and is_default), 'Bruno',
  'Bruno est maintenant le seul par défaut');

-- Campagne de A : sans choix, l'expéditeur par défaut ; avec un choix, celui-là
insert into public.lm_campaigns (account_id, space_id, name, country_code)
select acc_a, space_a, 'Campagne Snd', 'FR' from t_ids;

select is((select first_name from public.lm_campaign_sender((select id from public.lm_campaigns where name = 'Campagne Snd'))),
  'Bruno', 'Sans choix, la campagne utilise l''expéditeur par défaut');

update public.lm_campaigns set sender_id = (select id from public.lm_sender_profiles where first_name = 'Chloé')
 where name = 'Campagne Snd';
select is((select first_name from public.lm_campaign_sender((select id from public.lm_campaigns where name = 'Campagne Snd'))),
  'Chloé', 'La campagne utilise l''expéditeur choisi');

-- Organisation B : ne voit ni ne touche les expéditeurs de A
select makerkit.authenticate_as('snd_b');

insert into public.lm_sender_profiles (account_id, space_id, first_name, last_name, company, email, country_code)
select acc_b, space_b, 'Zoé', 'Bé', 'Société B', 'b@b.test', 'FR' from t_ids;

select is((select count(*)::int from public.lm_sender_profiles where account_id = (select acc_a from t_ids)), 0,
  'Une autre organisation ne voit pas les expéditeurs');
set local role postgres;
select set_config('test.sender_alice', (select id::text from public.lm_sender_profiles where first_name = 'Alice'), true);
select makerkit.authenticate_as('snd_b');
select throws_ok(
  format('select public.lm_set_default_sender(%L::uuid)', current_setting('test.sender_alice')),
  'P0002', 'sender not found', 'Une autre organisation ne peut pas choisir le défaut chez A');
select is((select count(*)::int from public.lm_campaign_sender((select id from public.lm_campaigns where name = 'Campagne Snd'))), 0,
  'Une autre organisation ne lit pas l''expéditeur d''une campagne de A');

delete from public.lm_sender_profiles where id = current_setting('test.sender_alice')::uuid;
set local role postgres;
select is((select count(*)::int from public.lm_sender_profiles where first_name = 'Alice'), 1,
  'Une autre organisation ne peut pas supprimer un expéditeur de A');

-- A ne peut pas mettre l'expéditeur de B sur sa campagne
select set_config('test.sender_zoe', (select id::text from public.lm_sender_profiles where first_name = 'Zoé'), true);
select makerkit.authenticate_as('snd_a');
select throws_ok(
  format('update public.lm_campaigns set sender_id = %L::uuid where name = %L', current_setting('test.sender_zoe'), 'Campagne Snd'),
  '23514', 'sender not in campaign space', 'Impossible de prendre l''expéditeur d''une autre organisation');

-- Suppression de l'expéditeur choisi : la campagne repasse sur celui par défaut
delete from public.lm_sender_profiles where first_name = 'Chloé';
select is((select sender_id from public.lm_campaigns where name = 'Campagne Snd'), null::uuid,
  'Expéditeur choisi supprimé : la campagne n''en a plus de particulier');
select is((select first_name from public.lm_campaign_sender((select id from public.lm_campaigns where name = 'Campagne Snd'))),
  'Bruno', 'Elle utilise alors l''expéditeur par défaut');

-- Suppression de l'expéditeur par défaut : un autre prend le relais
delete from public.lm_sender_profiles where first_name = 'Bruno';
select is((select string_agg(first_name, ',') from public.lm_sender_profiles
            where space_id = (select space_a from t_ids) and is_default), 'Alice',
  'L''expéditeur par défaut supprimé, le suivant le remplace');
select is((select first_name from public.lm_campaign_sender((select id from public.lm_campaigns where name = 'Campagne Snd'))),
  'Alice', 'La campagne suit le nouvel expéditeur par défaut');

set local role postgres;
select ok(not has_function_privilege('anon', 'public.lm_set_default_sender(uuid)', 'EXECUTE'),
  'Les visiteurs non connectés ne peuvent pas choisir le défaut');
select ok(not has_function_privilege('anon', 'public.lm_campaign_sender(uuid)', 'EXECUTE'),
  'Les visiteurs non connectés ne lisent pas les expéditeurs');

select * from finish();

rollback;
