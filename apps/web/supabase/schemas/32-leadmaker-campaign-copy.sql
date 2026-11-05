/*
 * -------------------------------------------------------
 * Section: LeadMaker duplication de campagne
 * Copie en brouillon : ciblage, filtres, messages, expéditeur et réglages d'envoi.
 * -------------------------------------------------------
 */

-- Renvoie l'identifiant de la copie. La validation automatique n'est reprise
-- que si le forfait l'inclut encore ; la raison de pause n'est pas copiée.
create or replace function public.lm_duplicate_campaign(p_campaign_id uuid, p_name text) returns uuid
set search_path = ''
language plpgsql
security definer
as $$
declare
  v_source public.lm_campaigns%rowtype;
  v_id uuid;
begin
  select * into v_source from public.lm_campaigns where id = p_campaign_id;

  if v_source.id is null or not public.lm_member(v_source.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  insert into public.lm_campaigns (account_id, space_id, name, country_code, targeting, filters, templates,
                                   daily_limit, auto_validation, sender_id)
  values (v_source.account_id, v_source.space_id, left(p_name, 255), v_source.country_code, v_source.targeting,
          v_source.filters - 'paused_reason', v_source.templates, v_source.daily_limit,
          v_source.auto_validation and public.lm_auto_validation_allowed(v_source.account_id), v_source.sender_id)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.lm_duplicate_campaign(uuid, text) from public;

grant execute on function public.lm_duplicate_campaign(uuid, text) to authenticated;
