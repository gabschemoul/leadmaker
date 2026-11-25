-- Profil de l'expéditeur complété : repréparation automatique des formulaires « à compléter » qui n'attendaient
-- qu'une case de ce profil (25/11/2026). Déclencheur lm_sender_profiles_reprepare.

-- Profil de l'expéditeur complété (téléphone, adresse, code postal…) : les formulaires restés « à compléter » parce
-- qu'une case de son profil était vide (le robot l'écrit : « champ obligatoire vide dans votre profil : … ») sont
-- repréparés tout seuls, avec le nouveau profil (25/11/2026 : 141 formulaires d'Électriciens France n'attendaient
-- que le téléphone). Seulement ceux des campagnes qui utilisent cet expéditeur, hors campagne archivée, prospect
-- exclu, site supprimé, sans forfait, ou pilote terminé/annulé (il dépasserait le nombre choisi). Les réponses déjà
-- saisies par l'utilisateur (extra) sont gardées. 2 000 formulaires au plus par modification.
-- Appelant : déclencheur (modification d'un expéditeur), sécurité definer (crée les tâches des robots).
create or replace function public.lm_sender_profiles_reprepare() returns trigger
set search_path = ''
language plpgsql
security definer
as $$
begin
  if (new.phone, new.address, new.zip, new.city, new.website, new.job_title, new.civility, new.company,
      new.first_name, new.last_name, new.email, new.country_code)
     is not distinct from
     (old.phone, old.address, old.zip, old.city, old.website, old.job_title, old.civility, old.company,
      old.first_name, old.last_name, old.email, old.country_code) then
    return null;
  end if;

  with picked as (
    select a.id
      from public.lm_attempts a
      join public.lm_campaigns c on c.id = a.campaign_id
      join public.lm_prospects p on p.id = a.prospect_id
      left join public.lm_autopilots ap on ap.id = a.autopilot_id
     where a.account_id = new.account_id
       and a.status = 'incomplete'
       and a.detail ilike '%vide dans votre profil%'
       and c.space_id = new.space_id
       and (c.sender_id = new.id or (c.sender_id is null and new.is_default))
       and c.status <> 'archived'
       and (a.autopilot_id is null or ap.status in ('preview', 'running', 'paused'))
       and p.excluded_at is null
       and public.lm_has_plan(a.account_id)
       and not public.lm_site_suppressed(a.account_id, a.space_id, p.site_key)
     order by a.updated_at desc
     limit 2000
       for update of a skip locked
  ),
  upd as (
    update public.lm_attempts a
       set status = 'pending', detail = null, missing = '[]'::jsonb, filled = '{}'::jsonb, protection_type = null,
           screenshot_before = null, form_url = null
      from picked
     where a.id = picked.id
    returning a.id, a.account_id
  )
  insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
  select upd.account_id, 'prepare', jsonb_build_object('attempt_id', upd.id),
         'prepare:' || upd.id::text || ':profile:' || extensions.uuid_generate_v4()::text
    from upd;

  return null;
end;
$$;

revoke all on function public.lm_sender_profiles_reprepare() from public, anon, authenticated;

create or replace trigger lm_sender_profiles_reprepare
  after update on public.lm_sender_profiles
  for each row execute function public.lm_sender_profiles_reprepare();
