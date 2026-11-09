alter table "public"."lm_campaign_prospects" add column "sorted_version" integer;

alter table "public"."lm_campaigns" add column "sort_groups" jsonb not null default '[]'::jsonb;

alter table "public"."lm_campaigns" add column "sort_target" text;

alter table "public"."lm_campaigns" add column "sort_version" integer not null default 0;

alter table "public"."lm_spaces" add column "offer" text;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_enqueue_sort()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
  select c.account_id, 'sort',
         jsonb_build_object('campaign_id', c.id, 'prospect_id', new.prospect_id, 'version', c.sort_version),
         'sort:' || c.id::text || ':' || new.prospect_id::text || ':' || c.sort_version::text
    from public.lm_campaigns c
   where c.id = new.campaign_id and nullif(trim(c.sort_target), '') is not null
  on conflict (idempotency_key) do nothing;

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_finish_sort(p_campaign_id uuid, p_prospect_id uuid, p_version integer, p_verdict text, p_group text, p_reason text, p_site_status text DEFAULT NULL::text, p_site_text text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_place_id text;
  v_count integer;
begin
  if p_verdict not in ('gardee', 'a_verifier', 'ecartee') then
    raise exception 'invalid verdict %', p_verdict using errcode = 'P0001';
  end if;

  -- Texte du site : pour tous les clients, même si l'avis arrive trop tard
  if p_site_status in ('ok', 'unreachable', 'social') then
    select p.google_place_id into v_place_id from public.lm_prospects p where p.id = p_prospect_id;

    if v_place_id is not null then
      update public.lm_places
         set site_status = p_site_status,
             site_text = case when p_site_status = 'ok' then left(p_site_text, 8000) end,
             site_read_at = now()
       where google_place_id = v_place_id;
    end if;
  end if;

  update public.lm_campaign_prospects cp
     set verdict = p_verdict,
         group_key = left(nullif(trim(p_group), ''), 60),
         reason = left(nullif(trim(p_reason), ''), 300),
         sorted_at = now(),
         sorted_version = p_version
   where cp.campaign_id = p_campaign_id and cp.prospect_id = p_prospect_id
     and p_version = (select c.sort_version from public.lm_campaigns c where c.id = p_campaign_id);

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_start_sort(p_campaign_id uuid, p_target text, p_offer text DEFAULT NULL::text, p_limit integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_target text := nullif(trim(p_target), '');
  v_count integer;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id for update;

  if v_campaign.id is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if v_target is null then
    raise exception 'empty target' using errcode = 'P0001', hint = 'sort_target_required';
  end if;

  if v_campaign.sort_target is distinct from v_target then
    update public.lm_campaigns set sort_target = v_target, sort_version = sort_version + 1
     where id = p_campaign_id
     returning * into v_campaign;
  end if;

  if nullif(trim(p_offer), '') is not null then
    update public.lm_spaces set offer = trim(p_offer) where id = v_campaign.space_id;
  end if;

  insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
  select v_campaign.account_id, 'sort',
         jsonb_build_object('campaign_id', v_campaign.id, 'prospect_id', cp.prospect_id,
                            'version', v_campaign.sort_version),
         'sort:' || v_campaign.id::text || ':' || cp.prospect_id::text || ':' || v_campaign.sort_version::text
    from (select cp.prospect_id
            from public.lm_campaign_prospects cp
           where cp.campaign_id = p_campaign_id
             and cp.sorted_version is distinct from v_campaign.sort_version
           order by md5(cp.prospect_id::text)
           limit p_limit) cp
  on conflict (idempotency_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;

CREATE TRIGGER lm_campaign_prospects_enqueue_sort AFTER INSERT ON public.lm_campaign_prospects FOR EACH ROW EXECUTE FUNCTION public.lm_enqueue_sort();



-- Écrit à la main (db diff ne les génère pas) : droits
revoke all on function public.lm_enqueue_sort() from public;
revoke all on function public.lm_start_sort(uuid, text, text, integer) from public;
grant execute on function public.lm_start_sort(uuid, text, text, integer) to service_role;
revoke all on function public.lm_finish_sort(uuid, uuid, integer, text, text, text, text, text) from public;
grant execute on function public.lm_finish_sort(uuid, uuid, integer, text, text, text, text, text) to service_role;
