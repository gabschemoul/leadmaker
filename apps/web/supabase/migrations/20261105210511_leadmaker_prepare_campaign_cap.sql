-- 5/11/2026 : « Préparer les formulaires » sur une grosse campagne (46 000 prospects) dépassait le délai et
-- annulait tout au plafond de 500. Désormais : seulement la place restante sous le plafond, les plus anciens d'abord.
-- Simple remplacement de fonction (droits conservés), compatible avec main.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_prepare_campaign(p_campaign_id uuid)
 RETURNS TABLE(queued integer, skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ids uuid[];
  v_space_id uuid;
  v_room integer;
begin
  -- accès vérifié une fois, pas ligne à ligne (grosses campagnes)
  select c.space_id into v_space_id
    from public.lm_campaigns c
   where c.id = p_campaign_id and public.lm_member(c.account_id);

  if v_space_id is null then
    return query select 0, 0;
    return;
  end if;

  -- place restante sous le plafond (même calcul que lm_prepare_prospects)
  select s.ready_forms_cap - (select count(*)::integer from public.lm_attempts a
                               where a.space_id = s.id and a.status in ('pending', 'preparing', 'ready', 'incomplete'))
    into v_room
    from public.lm_spaces s
   where s.id = v_space_id;

  if coalesce(v_room, 0) <= 0 then
    raise exception 'ready forms cap reached for space %', v_space_id using errcode = 'P0001', hint = 'cap_reached';
  end if;

  select array_agg(x.id order by x.created_at) into v_ids
    from (select p.id, p.created_at
            from public.lm_prospects p
            left join public.lm_attempts a on a.space_id = p.space_id and a.prospect_id = p.id
           where p.campaign_id = p_campaign_id
             and p.excluded_at is null and p.website is not null
             and p.site_key not like 'maps:%' and p.site_key not like 'tel:%'
             and (a.id is null or public.lm_attempt_repreparable(a.status))
           order by p.created_at
           limit v_room) x;

  if v_ids is null then
    return query select 0, 0;
    return;
  end if;

  return query select * from public.lm_prepare_prospects(v_ids, null);
end;
$function$
;


