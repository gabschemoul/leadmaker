
  create table "public"."lm_campaign_prospects" (
    "campaign_id" uuid not null,
    "prospect_id" uuid not null,
    "account_id" uuid not null,
    "space_id" uuid not null,
    "verdict" text,
    "group_key" text,
    "reason" text,
    "sorted_at" timestamp with time zone,
    "client_choice" text,
    "decided_at" timestamp with time zone,
    "credits" integer not null default 0,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_campaign_prospects" enable row level security;

CREATE INDEX ix_lm_campaign_prospects_account_id ON public.lm_campaign_prospects USING btree (account_id);

CREATE INDEX ix_lm_campaign_prospects_campaign_id_created_at ON public.lm_campaign_prospects USING btree (campaign_id, created_at DESC);

CREATE INDEX ix_lm_campaign_prospects_prospect_id ON public.lm_campaign_prospects USING btree (prospect_id);

CREATE UNIQUE INDEX lm_campaign_prospects_pkey ON public.lm_campaign_prospects USING btree (campaign_id, prospect_id);

alter table "public"."lm_campaign_prospects" add constraint "lm_campaign_prospects_pkey" PRIMARY KEY using index "lm_campaign_prospects_pkey";

alter table "public"."lm_campaign_prospects" add constraint "lm_campaign_prospects_account_id_fkey" FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE not valid;

alter table "public"."lm_campaign_prospects" validate constraint "lm_campaign_prospects_account_id_fkey";

alter table "public"."lm_campaign_prospects" add constraint "lm_campaign_prospects_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.lm_campaigns(id) ON DELETE CASCADE not valid;

alter table "public"."lm_campaign_prospects" validate constraint "lm_campaign_prospects_campaign_id_fkey";

alter table "public"."lm_campaign_prospects" add constraint "lm_campaign_prospects_client_choice" CHECK (((client_choice IS NULL) OR (client_choice = ANY (ARRAY['gardee'::text, 'ecartee'::text])))) not valid;

alter table "public"."lm_campaign_prospects" validate constraint "lm_campaign_prospects_client_choice";

alter table "public"."lm_campaign_prospects" add constraint "lm_campaign_prospects_credits" CHECK ((credits >= 0)) not valid;

alter table "public"."lm_campaign_prospects" validate constraint "lm_campaign_prospects_credits";

alter table "public"."lm_campaign_prospects" add constraint "lm_campaign_prospects_prospect_id_fkey" FOREIGN KEY (prospect_id) REFERENCES public.lm_prospects(id) ON DELETE CASCADE not valid;

alter table "public"."lm_campaign_prospects" validate constraint "lm_campaign_prospects_prospect_id_fkey";

alter table "public"."lm_campaign_prospects" add constraint "lm_campaign_prospects_space_id_fkey" FOREIGN KEY (space_id) REFERENCES public.lm_spaces(id) ON DELETE CASCADE not valid;

alter table "public"."lm_campaign_prospects" validate constraint "lm_campaign_prospects_space_id_fkey";

alter table "public"."lm_campaign_prospects" add constraint "lm_campaign_prospects_verdict" CHECK (((verdict IS NULL) OR (verdict = ANY (ARRAY['gardee'::text, 'a_verifier'::text, 'ecartee'::text])))) not valid;

alter table "public"."lm_campaign_prospects" validate constraint "lm_campaign_prospects_verdict";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_check_campaign_prospect()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.lm_campaigns c
                  where c.id = new.campaign_id and c.space_id = new.space_id and c.account_id = new.account_id)
     or not exists (select 1 from public.lm_prospects p
                     where p.id = new.prospect_id and p.space_id = new.space_id and p.account_id = new.account_id) then
    raise exception 'campaign % and prospect % are not in space %', new.campaign_id, new.prospect_id, new.space_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_prepare_prospects(p_ids uuid[], p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(queued integer, skipped integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_queued integer := 0;
  v_skipped integer := 0;
  v_round text := extract(epoch from clock_timestamp())::bigint::text;
  v_attempt_id uuid;
  v_ready integer;
  v_cap integer;
  r record;
begin
  for r in
    select p.id, p.account_id, p.space_id, p.website, p.site_key, p.excluded_at,
           -- Entreprise liée à la campagne demandée (lm_campaign_prospects, CDC §7) : contactée au nom de celle-ci,
           -- avec ses messages ; sinon sa campagne d'origine, puis la campagne demandée (prospects importés)
           case
             when p_campaign_id is not null and exists (
                    select 1 from public.lm_campaign_prospects cp
                     where cp.campaign_id = p_campaign_id and cp.prospect_id = p.id) then p_campaign_id
             else coalesce(p.campaign_id, p_campaign_id)
           end as campaign_id
      from public.lm_prospects p
     where p.id = any (p_ids) and public.lm_member(p.account_id)
     order by p.created_at
  loop
    v_attempt_id := null;

    -- Robots réservés aux organisations avec un forfait (audit A9)
    if not public.lm_has_plan(r.account_id) then
      raise exception 'no plan for account %', r.account_id using errcode = 'P0001', hint = 'no_plan';
    end if;

    -- Sans site web, exclu, en liste d'opposition ou sans campagne : rien à préparer
    if r.excluded_at is not null or r.website is null or r.site_key like 'maps:%' or r.site_key like 'tel:%'
       or r.campaign_id is null or public.lm_site_suppressed(r.account_id, r.space_id, r.site_key) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if not exists (select 1 from public.lm_sender_profiles s where s.space_id = r.space_id) then
      raise exception 'no sender profile for space %', r.space_id using errcode = 'P0001', hint = 'no_sender';
    end if;

    if not exists (select 1 from public.lm_campaigns c
                    where c.id = r.campaign_id and c.space_id = r.space_id and public.lm_templates_usable(c.templates)) then
      raise exception 'campaign % has no message', r.campaign_id using errcode = 'P0001', hint = 'no_messages';
    end if;

    -- Plafond de formulaires prêts non validés (par espace)
    select count(*) into v_ready from public.lm_attempts a
     where a.space_id = r.space_id and a.status in ('pending', 'preparing', 'ready', 'incomplete');
    select ready_forms_cap into v_cap from public.lm_spaces where id = r.space_id;

    if v_ready >= v_cap then
      raise exception 'ready forms cap reached for space %', r.space_id using errcode = 'P0001', hint = 'cap_reached';
    end if;

    insert into public.lm_attempts (account_id, space_id, campaign_id, prospect_id, status)
    values (r.account_id, r.space_id, r.campaign_id, r.id, 'pending')
    on conflict (space_id, prospect_id) do update
      set status = 'pending', campaign_id = excluded.campaign_id, detail = null, missing = '[]'::jsonb,
          filled = '{}'::jsonb, protection_type = null, screenshot_before = null, form_url = null,
          -- re-préparée à la main : elle quitte le pilote automatique et le robot rechoisit le message
          template_name = null, autopilot_id = null
      where public.lm_attempt_repreparable(public.lm_attempts.status)
    returning id into v_attempt_id;

    if v_attempt_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.lm_tasks (account_id, kind, payload, idempotency_key)
    values (r.account_id, 'prepare', jsonb_build_object('attempt_id', v_attempt_id),
            'prepare:' || v_attempt_id::text || ':' || v_round)
    on conflict (idempotency_key) do nothing;

    v_queued := v_queued + 1;
  end loop;

  return query select v_queued, v_skipped;
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
    insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id, credits)
    select p_campaign_id, p.id, p.account_id, p.space_id, 0
      from public.lm_prospects p
     where p.space_id = v_campaign.space_id and p.site_key = p_place ->> 'site_key'
    on conflict (campaign_id, prospect_id) do nothing;

    return 'duplicate';
  end if;

  v_credits := greatest(v_campaign.credits_per_prospect, 1);

  if not public.lm_debit_credits(v_campaign.account_id, 'discovery', v_credits,
                                 'prospect:' || v_id, 'discovery', p_campaign_id) then
    delete from public.lm_prospects where id = v_id;
    perform public.lm_pause_campaign(p_campaign_id, 'no_credits');
    return 'no_credits';
  end if;

  insert into public.lm_campaign_prospects (campaign_id, prospect_id, account_id, space_id, credits)
  values (p_campaign_id, v_id, v_campaign.account_id, v_campaign.space_id, v_credits)
  on conflict (campaign_id, prospect_id) do nothing;

  update public.lm_place_sightings set kept = true
   where space_id = v_campaign.space_id and google_place_id = p_place ->> 'place_id';

  return 'kept';
end;
$function$
;

grant select on table "public"."lm_campaign_prospects" to "authenticated";

grant delete on table "public"."lm_campaign_prospects" to "service_role";

grant insert on table "public"."lm_campaign_prospects" to "service_role";

grant select on table "public"."lm_campaign_prospects" to "service_role";

grant update on table "public"."lm_campaign_prospects" to "service_role";


  create policy "lm_campaign_prospects_read"
  on "public"."lm_campaign_prospects"
  as permissive
  for select
  to authenticated
using ((account_id IN ( SELECT public.lm_user_account_ids() AS lm_user_account_ids)));



  create policy "restrict_mfa_lm_campaign_prospects"
  on "public"."lm_campaign_prospects"
  as restrictive
  for all
  to authenticated
using (( SELECT public.is_mfa_compliant() AS is_mfa_compliant));


CREATE TRIGGER lm_campaign_prospects_check_space BEFORE INSERT OR UPDATE OF campaign_id, prospect_id, account_id, space_id ON public.lm_campaign_prospects FOR EACH ROW EXECUTE FUNCTION public.lm_check_campaign_prospect();



-- Écrit à la main (db diff ne les génère pas) : droits, commentaires
revoke all on public.lm_campaign_prospects from anon, authenticated, service_role;
grant select, insert, update, delete on table public.lm_campaign_prospects to service_role;
grant select on table public.lm_campaign_prospects to authenticated;

revoke all on function public.lm_check_campaign_prospect() from public;

comment on table public.lm_campaign_prospects is 'Entreprises de chaque campagne (une entreprise peut être dans plusieurs campagnes de son espace) : tri, choix du client, crédits';

