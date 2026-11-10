-- 10/11/2026 : packs de crédits (roadmap n°5 : S 3 000 / M 9 000 / L 18 000 crédits). Valables 12 mois, consommés
-- après les crédits du forfait (lm_debit_credits), ajoutés une fois par commande Stripe (lm_grant_credit_pack).
-- Compatible avec le code en ligne.


  create table "public"."lm_credit_packs" (
    "id" uuid not null default extensions.uuid_generate_v4(),
    "account_id" uuid not null,
    "pack_id" text not null,
    "credits" integer not null,
    "remaining" integer not null,
    "purchased_at" timestamp with time zone not null default now(),
    "expires_at" timestamp with time zone not null default (now() + '1 year'::interval),
    "order_ref" text not null
      );


alter table "public"."lm_credit_packs" enable row level security;

revoke all on public.lm_credit_packs from anon, authenticated, service_role;

CREATE INDEX ix_lm_credit_packs_account_id_expires_at ON public.lm_credit_packs USING btree (account_id, expires_at);

CREATE UNIQUE INDEX lm_credit_packs_order_ref ON public.lm_credit_packs USING btree (order_ref);

CREATE UNIQUE INDEX lm_credit_packs_pkey ON public.lm_credit_packs USING btree (id);

alter table "public"."lm_credit_packs" add constraint "lm_credit_packs_pkey" PRIMARY KEY using index "lm_credit_packs_pkey";

alter table "public"."lm_credit_packs" add constraint "lm_credit_packs_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_credit_packs" validate constraint "lm_credit_packs_account_id_fkey";

alter table "public"."lm_credit_packs" add constraint "lm_credit_packs_credits_positive" CHECK ((credits > 0)) not valid;

alter table "public"."lm_credit_packs" validate constraint "lm_credit_packs_credits_positive";

alter table "public"."lm_credit_packs" add constraint "lm_credit_packs_order_ref" UNIQUE using index "lm_credit_packs_order_ref";

alter table "public"."lm_credit_packs" add constraint "lm_credit_packs_remaining" CHECK (((remaining >= 0) AND (remaining <= credits))) not valid;

alter table "public"."lm_credit_packs" validate constraint "lm_credit_packs_remaining";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_available_credits(p_account_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when (select auth.role()) = 'service_role' or current_setting('role', true) = 'service_role'
                or public.lm_member(p_account_id)
              then coalesce((select c.discovery_balance from public.lm_account_credits c where c.account_id = p_account_id), 0)
                   + public.lm_pack_credits(p_account_id)
         end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_grant_credit_pack(p_account_id uuid, p_pack_id text, p_credits integer, p_order_ref text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_credits is null or p_credits <= 0 or nullif(trim(p_order_ref), '') is null then
    raise exception 'invalid pack' using errcode = 'P0001';
  end if;

  insert into public.lm_credit_packs (account_id, pack_id, credits, remaining, order_ref)
  values (p_account_id, p_pack_id, p_credits, p_credits, p_order_ref)
  on conflict (order_ref) do nothing;

  if not found then
    return false;
  end if;

  insert into public.lm_credit_ledger (account_id, kind, delta, reason, event_ref)
  values (p_account_id, 'discovery', p_credits, 'pack', 'pack:' || p_order_ref)
  on conflict do nothing;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_pack_credits(p_account_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(sum(p.remaining), 0)::integer from public.lm_credit_packs p
   where p.account_id = p_account_id and p.remaining > 0 and p.expires_at > now();
$function$
;

CREATE OR REPLACE FUNCTION public.lm_debit_credits(p_account_id uuid, p_kind public.lm_credit_kind, p_quantity integer, p_event_ref text, p_reason text, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_balance integer;
  v_rest integer;
  v_take integer;
  v_pack record;
begin
  if p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;

  if exists (select 1 from public.lm_credit_ledger where event_ref = p_event_ref) then
    return false;
  end if;

  if p_kind = 'discovery' then
    select discovery_balance into v_balance from public.lm_account_credits
      where account_id = p_account_id for update;
  else
    select outreach_balance into v_balance from public.lm_account_credits
      where account_id = p_account_id for update;
  end if;

  -- Packs de crédits (10/11/2026) : utilisés seulement quand le forfait ne suffit plus
  if p_kind = 'discovery' and v_balance is not null and v_balance < p_quantity then
    perform 1 from public.lm_credit_packs p
     where p.account_id = p_account_id and p.remaining > 0 and p.expires_at > now()
       for update;

    if v_balance + public.lm_pack_credits(p_account_id) < p_quantity then
      return false;
    end if;
  elsif v_balance is null or v_balance < p_quantity then
    return false;
  end if;

  -- Deux appels simultanés avec le même event_ref : le second bute sur l'unicité du journal ; on annule
  -- alors son débit et on renvoie false, comme pour un événement déjà débité.
  begin
    insert into public.lm_credit_ledger (account_id, kind, delta, reason, campaign_id, event_ref)
      values (p_account_id, p_kind, -p_quantity, p_reason, p_campaign_id, p_event_ref);
  exception when unique_violation then
    return false;
  end;

  if p_kind = 'discovery' then
    -- d'abord les crédits du forfait, puis les packs, le plus proche de son expiration d'abord
    update public.lm_account_credits set discovery_balance = discovery_balance - least(v_balance, p_quantity)
      where account_id = p_account_id;

    v_rest := p_quantity - least(v_balance, p_quantity);

    for v_pack in
      select p.id, p.remaining from public.lm_credit_packs p
       where p.account_id = p_account_id and p.remaining > 0 and p.expires_at > now()
       order by p.expires_at, p.purchased_at
    loop
      exit when v_rest <= 0;
      v_take := least(v_pack.remaining, v_rest);
      update public.lm_credit_packs set remaining = remaining - v_take where id = v_pack.id;
      v_rest := v_rest - v_take;
    end loop;
  else
    update public.lm_account_credits set outreach_balance = outreach_balance - p_quantity
      where account_id = p_account_id;
  end if;

  return true;
end;
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

CREATE OR REPLACE FUNCTION public.lm_start_campaign(p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.lm_campaigns%rowtype;
  v_limit integer;
  v_running integer;
  v_balance integer;
  v_estimate_id uuid;
  v_credits integer;
begin
  select * into v_campaign from public.lm_campaigns where id = p_campaign_id for update;

  if v_campaign.id is null or not public.lm_member(v_campaign.account_id) then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  if v_campaign.status = 'running' then
    return;
  end if;

  if v_campaign.status = 'archived' then
    raise exception 'campaign archived' using errcode = 'P0001', hint = 'archived';
  end if;

  select p.active_campaigns, c.discovery_balance + public.lm_pack_credits(c.account_id) into v_limit, v_balance
    from public.lm_account_credits c left join public.lm_plans p on p.id = c.plan_id
   where c.account_id = v_campaign.account_id;

  if v_balance is null or v_balance <= 0 then
    raise exception 'no discovery credits' using errcode = 'P0001', hint = 'no_credits';
  end if;

  -- un lancement à la fois par organisation : deux lancements simultanés ne dépassent pas le quota (audit A14)
  perform pg_advisory_xact_lock(hashtext('lm_start_campaign:' || v_campaign.account_id::text));

  select count(*) into v_running from public.lm_campaigns
   where account_id = v_campaign.account_id and status = 'running';

  if v_limit is not null and v_running >= v_limit then
    raise exception 'active campaign limit reached' using errcode = 'P0001', hint = 'campaign_limit';
  end if;

  -- Premier lancement : on fige les villes, les catégories et le tarif (crédits par prospect)
  if not exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id) then
    -- Le tarif vient de l'estimation faite avec exactement ce ciblage et ces filtres (roadmap n°13).
    -- Audit A7 : la PLUS CHÈRE des 7 derniers jours (sinon relancer l'estimation jusqu'à tomber sur un
    -- échantillon favorable faisait baisser le tarif).
    select e.id, e.credits_per_prospect into v_estimate_id, v_credits
      from public.lm_estimates e
     where e.account_id = v_campaign.account_id and e.status = 'done'
       and e.created_at > now() - interval '7 days'
       and e.country_code = v_campaign.country_code
       and e.targeting = v_campaign.targeting
       and e.filters = (v_campaign.filters - 'paused_reason')
     order by e.credits_per_prospect desc nulls last, e.created_at desc
     limit 1;

    if v_estimate_id is not null then
      update public.lm_campaigns
         set credits_per_prospect = coalesce(v_credits, 1), estimate_id = v_estimate_id, price_pending = false
       where id = p_campaign_id;
    else
      -- 4/11/2026 : plus aucune attente avant le lancement. Sans estimation terminée, la campagne part tout
      -- de suite à 1 crédit par prospect ; la mesure (celle en cours, sinon une nouvelle) tourne en parallèle
      -- et fixe le tarif quand elle se termine (lm_record_estimate_search).
      select e.id into v_estimate_id
        from public.lm_estimates e
       where e.account_id = v_campaign.account_id and e.status = 'running'
         and e.country_code = v_campaign.country_code
         and e.targeting = v_campaign.targeting
         and e.filters = (v_campaign.filters - 'paused_reason')
       order by e.created_at desc
       limit 1
         for update;

      if v_estimate_id is null then
        v_estimate_id := public.lm_create_estimate(v_campaign.account_id, v_campaign.country_code,
                                                   v_campaign.targeting, v_campaign.filters - 'paused_reason');
      end if;

      update public.lm_campaigns
         set credits_per_prospect = 1, estimate_id = v_estimate_id, price_pending = true
       where id = p_campaign_id;
    end if;

    -- Ordre de passage : chaque ville par son nom (des plus peuplées aux moins peuplées), puis les secteurs
    -- des grandes villes en alternant les villes
    insert into public.lm_campaign_zones (campaign_id, idx, pos, account_id, geoname_id, label, population,
                                          latitude, longitude, zoom)
      select p_campaign_id, z.rn - 1, z.rn - 1,
             v_campaign.account_id, z.geoname_id, z.label, z.population, z.latitude, z.longitude, z.zoom
        from (select t.*, row_number() over (
                       order by t.latitude is not null, coalesce(substring(t.label from ' · ([0-9]+)$')::integer, 0),
                                t.population desc, t.geoname_id, t.label) as rn
                from public.lm_target_zones(v_campaign.country_code, v_campaign.targeting) t) z;

    insert into public.lm_campaign_categories (campaign_id, gcid, account_id, is_generic)
      select p_campaign_id, t.gcid, v_campaign.account_id, t.is_generic
        from public.lm_target_categories(v_campaign.targeting) t;
  end if;

  if not exists (select 1 from public.lm_campaign_zones where campaign_id = p_campaign_id) then
    raise exception 'no city matches the targeting' using errcode = 'P0001', hint = 'no_cities';
  end if;

  -- Reprise après une pause : les recherches annulées repartent
  update public.lm_tasks set status = 'queued', run_after = now(), finished_at = null, attempts = 0, error = null
   where kind = 'discovery' and status = 'cancelled' and payload ->> 'campaign_id' = p_campaign_id::text;

  -- Les places occupées repartent des vraies tâches en file ou en cours
  perform public.lm_recount_in_flight(p_campaign_id);

  update public.lm_campaigns
     set status = 'running', filters = filters - 'paused_reason'
   where id = p_campaign_id;
end;
$function$
;

grant select on table "public"."lm_credit_packs" to "authenticated";

grant delete on table "public"."lm_credit_packs" to "service_role";

grant insert on table "public"."lm_credit_packs" to "service_role";

grant select on table "public"."lm_credit_packs" to "service_role";

grant update on table "public"."lm_credit_packs" to "service_role";


  create policy "lm_credit_packs_read"
  on "public"."lm_credit_packs"
  as permissive
  for select
  to authenticated
using ((account_id IN ( SELECT public.lm_user_account_ids() AS lm_user_account_ids)));



  create policy "restrict_mfa_lm_credit_packs"
  on "public"."lm_credit_packs"
  as restrictive
  for all
  to authenticated
using (( SELECT public.is_mfa_compliant() AS is_mfa_compliant));




revoke all on function public.lm_pack_credits(uuid) from public, anon, authenticated;

grant execute on function public.lm_pack_credits(uuid) to service_role;

revoke all on function public.lm_available_credits(uuid) from public, anon;

grant execute on function public.lm_available_credits(uuid) to authenticated, service_role;

revoke all on function public.lm_grant_credit_pack(uuid, text, integer, text) from public, anon, authenticated;

grant execute on function public.lm_grant_credit_pack(uuid, text, integer, text) to service_role;
