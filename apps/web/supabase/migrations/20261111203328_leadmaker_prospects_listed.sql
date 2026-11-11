-- 11/11/2026, retours de Gabriel :
--  * page Prospects : les fiches écartées (ou à vérifier, jamais payées) d'une campagne triée n'y apparaissent plus
--    (lm_prospects.listed) ; elles restent en base et dans l'annuaire commun (lm_places) ;
--  * e-mail « recherche terminée » d'une campagne triée : le nombre de prospects gardés (payload « kept »).
-- Compatible avec main : colonne avec défaut (toutes les fiches restent visibles pour le code en ligne).

alter table "public"."lm_prospects" add column "listed" boolean not null default true;

CREATE INDEX ix_lm_prospects_space_listed ON public.lm_prospects USING btree (space_id, created_at DESC NULLS LAST, id) INCLUDE (account_id) WHERE ((excluded_at IS NULL) AND listed);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_campaign_prospect_listed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.lm_prospects set listed = true where id = new.prospect_id and not listed;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_notify_campaign()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    -- campagne triée : aussi le nombre de prospects gardés, annoncé dans l'e-mail à la place des fiches trouvées
    -- (11/11/2026 : « 113 prospects trouvés » alors que 69 seulement correspondaient)
    perform public.lm_notify('search_done', new.account_id, new.id,
      jsonb_build_object('prospects', (select count(*) from public.lm_prospects p where p.campaign_id = new.id))
      || case when nullif(trim(new.sort_target), '') is not null
              then jsonb_build_object('kept', (select count(*) from public.lm_campaign_prospects cp
                                                where cp.campaign_id = new.id
                                                  and coalesce(cp.client_choice, cp.verdict) = 'gardee'))
              else '{}'::jsonb end,
      'search_done:' || new.id::text || ':' || current_date::text);
  elsif new.status = 'paused' and new.filters ->> 'paused_reason' = 'no_credits'
        and not (old.status = 'paused' and old.filters ->> 'paused_reason' = 'no_credits') then
    perform public.lm_notify('search_no_credits', new.account_id, new.id,
      jsonb_build_object('prospects', (select count(*) from public.lm_prospects p where p.campaign_id = new.id)),
      'search_no_credits:' || new.id::text || ':' || current_date::text);
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_prospect_facets(p_space_id uuid)
 RETURNS TABLE(kind text, value text, total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with allowed as (
    select s.id from public.lm_spaces s where s.id = p_space_id and public.lm_member(s.account_id)
  )
  select 'category', p.category, count(*) from public.lm_prospects p
   where p.space_id = (select id from allowed) and p.listed and p.category is not null group by p.category
  union all
  select 'city', p.city, count(*) from public.lm_prospects p
   where p.space_id = (select id from allowed) and p.listed and p.city is not null group by p.city
  union all
  select 'campaign', c.id::text, count(*) from public.lm_prospects p
    join public.lm_campaigns c on c.id = p.campaign_id
   where p.space_id = (select id from allowed) and p.listed group by c.id
  order by 1, 3 desc, 2;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_record_prospect(p_campaign_id uuid, p_place jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_id uuid;
  v_credits integer;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id;

  insert into public.lm_prospects (account_id, space_id, google_place_id, name, category, rating, review_count,
                                   address, country_code, phone, website, site_key, maps_url, source, campaign_id, city)
  values (v_campaign.account_id, v_campaign.space_id, p_place ->> 'place_id', left(p_place ->> 'name', 500),
          left(p_place ->> 'category', 255), (p_place ->> 'rating')::numeric(2,1), (p_place ->> 'review_count')::integer,
          p_place ->> 'address', v_campaign.country_code, left(p_place ->> 'phone', 50), public.lm_clean_website(p_place ->> 'website'),
          p_place ->> 'site_key', left(p_place ->> 'maps_url', 1000), 'maps', p_campaign_id, left(p_place ->> 'city', 200))
  on conflict (space_id, site_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- Déjà dans l'espace (trouvée par une autre campagne ou importée) : liée à cette campagne, sans débit
    insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id, credits, paid_at, gcid)
    select p_campaign_id, p.id, p.account_id, p.space_id, 0, now(), nullif(p_place ->> 'gcid', '')
      from public.lm_prospects p
     where p.space_id = v_campaign.space_id and p.site_key = p_place ->> 'site_key'
    on conflict (campaign_id, prospect_id) do nothing;

    return 'duplicate';
  end if;

  if nullif(trim(v_campaign.sort_target), '') is not null then
    -- Payée plus tard, si le tri la garde ; plus aucun crédit : la recherche s'arrête là
    if coalesce((select c.discovery_balance from public.lm_account_credits c
                  where c.account_id = v_campaign.account_id), 0) + public.lm_pack_credits(v_campaign.account_id) <= 0 then
      delete from public.lm_prospects where id = v_id;
      perform public.lm_pause_campaign(p_campaign_id, 'no_credits');
      return 'no_credits';
    end if;
    v_credits := 0;
    -- pas sur la page Prospects tant qu'elle n'est pas payée (lm_campaign_prospect_listed la rend visible)
    update public.lm_prospects set listed = false where id = v_id;
  else
    v_credits := greatest(v_campaign.credits_per_prospect, 1);

    if not public.lm_debit_credits(v_campaign.account_id, 'discovery', v_credits,
                                   'prospect:' || v_id, 'discovery', p_campaign_id) then
      delete from public.lm_prospects where id = v_id;
      perform public.lm_pause_campaign(p_campaign_id, 'no_credits');
      return 'no_credits';
    end if;
  end if;

  insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id, credits, paid_at, gcid)
  values (p_campaign_id, v_id, v_campaign.account_id, v_campaign.space_id, v_credits,
          case when v_credits > 0 then now() end, nullif(p_place ->> 'gcid', ''))
  -- lien déjà posé par le déclencheur lm_prospects_campaign_link : on le complète
  on conflict (campaign_id, prospect_id) do update
    set credits = excluded.credits, paid_at = excluded.paid_at, gcid = excluded.gcid;

  update public.lm_place_sightings set kept = true
   where space_id = v_campaign.space_id and google_place_id = p_place ->> 'place_id';

  return 'kept';
end;
$function$
;

CREATE TRIGGER lm_campaign_prospects_listed AFTER INSERT OR UPDATE OF paid_at ON public.lm_campaign_prospects FOR EACH ROW WHEN ((new.paid_at IS NOT NULL)) EXECUTE FUNCTION public.lm_campaign_prospect_listed();



revoke all on function public.lm_campaign_prospect_listed() from public;

-- Rattrapage : fiches trouvées par une campagne triée et jamais payées → plus sur la page Prospects
update public.lm_prospects p
   set listed = false
 where p.listed and p.source = 'maps'
   and exists (select 1 from public.lm_campaigns c
                where c.id = p.campaign_id and nullif(trim(c.sort_target), '') is not null)
   and not exists (select 1 from public.lm_campaign_prospects cp
                    where cp.prospect_id = p.id and cp.paid_at is not null);
