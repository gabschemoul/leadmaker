/*
 * -------------------------------------------------------
 * Section: LeadMaker recherche d'e-mails sur le site
 * Action « Chercher les e-mails » de la page Prospects : une tâche `emails`
 * par prospect, le worker relève l'adresse sur le site (accueil, contact,
 * mentions légales) sans préparer de formulaire ni rien envoyer.
 * -------------------------------------------------------
 */

-- Met en file une recherche d'e-mail pour chaque prospect sélectionné qui a un site et pas encore d'adresse.
-- Renvoie (lancées, passées). Les prospects d'une autre organisation sont ignorés.
create or replace function public.lm_find_emails(p_ids uuid[])
returns table (queued integer, skipped integer)
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_queued integer := 0;
  v_skipped integer := 0;
  v_round text := extract(epoch from clock_timestamp())::bigint::text;
  r record;
begin
  for r in
    select p.id, p.account_id, p.website, p.site_key, p.excluded_at, p.found_email
      from public.lm_prospects p
     where p.id = any (p_ids) and public.lm_member(p.account_id)
     order by p.created_at
  loop
    -- Robots réservés aux organisations avec un forfait (audit A9)
    if not public.lm_has_plan(r.account_id) then
      raise exception 'no plan for account %', r.account_id using errcode = 'P0001', hint = 'no_plan';
    end if;

    if r.excluded_at is not null or r.website is null or r.site_key like 'maps:%' or r.site_key like 'tel:%'
       or r.found_email is not null
       or exists (select 1 from public.lm_tasks t
                   where t.kind = 'emails' and t.status in ('queued', 'running')
                     and t.payload ->> 'prospect_id' = r.id::text) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
    values (r.account_id, 'emails', jsonb_build_object('prospect_id', r.id), 'emails:' || r.id::text || ':' || v_round)
    on conflict (idempotency_key) do nothing;

    v_queued := v_queued + 1;
  end loop;

  return query select v_queued, v_skipped;
end;
$$;
revoke all on function public.lm_find_emails(uuid[]) from public;

grant execute on function public.lm_find_emails(uuid[]) to authenticated, service_role;

-- Résultat du worker : adresse trouvée (ou null) ; la date de recherche est posée dans tous les cas.
create or replace function public.lm_finish_emails(p_prospect_id uuid, p_email text) returns boolean
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_email text := left(nullif(trim(coalesce(p_email, '')), ''), 320);
begin
  update public.lm_prospects
     set found_email = coalesce(v_email, found_email),
         email_checked_at = now()
   where id = p_prospect_id;

  return found;
end;
$$;
revoke all on function public.lm_finish_emails(uuid, text) from public;

grant execute on function public.lm_finish_emails(uuid, text) to service_role;
