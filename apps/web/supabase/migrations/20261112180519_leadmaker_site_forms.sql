
  create table "public"."lm_site_forms" (
    "site_key" text not null,
    "status" text not null,
    "form_url" character varying(2000),
    "checked_at" timestamp with time zone not null default now(),
    "source" text not null default 'app'::text,
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."lm_site_forms" enable row level security;

alter table "public"."lm_discovery_settings" add column "site_forms_trust_since" timestamp with time zone not null default '2026-11-12 11:30:00+00'::timestamp with time zone;

CREATE UNIQUE INDEX lm_site_forms_pkey ON public.lm_site_forms USING btree (site_key);

alter table "public"."lm_site_forms" add constraint "lm_site_forms_pkey" PRIMARY KEY using index "lm_site_forms_pkey";

alter table "public"."lm_site_forms" add constraint "lm_site_forms_source" CHECK ((source = ANY (ARRAY['app'::text, 'old_tool'::text]))) not valid;

alter table "public"."lm_site_forms" validate constraint "lm_site_forms_source";

alter table "public"."lm_site_forms" add constraint "lm_site_forms_status" CHECK ((status = ANY (ARRAY['form'::text, 'no_form'::text, 'protected'::text, 'unreachable'::text]))) not valid;

alter table "public"."lm_site_forms" validate constraint "lm_site_forms_status";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_attempts_record_site_form()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status text := public.lm_site_form_status(new.status);
  v_key text;
begin
  if v_status is null
     or (tg_op = 'UPDATE' and new.status is not distinct from old.status)
     or coalesce(new.detail, '') like 'déjà vérifié%' then
    return null;
  end if;

  select p.site_key into v_key from public.lm_prospects p where p.id = new.prospect_id;

  if v_key is null or v_key like 'maps:%' or v_key like 'tel:%' then
    return null;
  end if;

  insert into public.lm_site_forms as f (site_key, status, form_url, checked_at, source)
  values (v_key, v_status, case when v_status in ('form', 'protected') then left(new.form_url, 2000) end, now(), 'app')
  on conflict (site_key) do update
    set status = excluded.status,
        form_url = coalesce(excluded.form_url, case when excluded.status in ('form', 'protected') then f.form_url end),
        checked_at = excluded.checked_at,
        source = 'app',
        updated_at = now();

  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_site_form_status(p_status public.lm_attempt_status)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_status
           when 'no_form' then 'no_form'
           when 'unreachable' then 'unreachable'
           when 'intervention_required' then 'protected'
           when 'ready' then 'form'
           when 'incomplete' then 'form'
           when 'validated' then 'form'
           when 'to_verify' then 'form'
           when 'sent' then 'form'
         end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_site_known_no_form(p_site_key text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select f.checked_at
    from public.lm_site_forms f, public.lm_discovery_settings s
   where s.id and f.site_key = p_site_key and f.status = 'no_form' and f.source = 'app'
     and f.checked_at >= s.site_forms_trust_since
     and f.checked_at > now() - make_interval(days => s.places_max_age_days);
$function$
;

grant delete on table "public"."lm_site_forms" to "service_role";

grant insert on table "public"."lm_site_forms" to "service_role";

grant select on table "public"."lm_site_forms" to "service_role";

grant update on table "public"."lm_site_forms" to "service_role";

CREATE TRIGGER lm_attempts_record_site_form AFTER INSERT OR UPDATE OF status ON public.lm_attempts FOR EACH ROW EXECUTE FUNCTION public.lm_attempts_record_site_form();


-- Droits (non produits par le diff) : robots seulement
revoke all on table public.lm_site_forms from anon, authenticated;
revoke all on function public.lm_site_form_status(public.lm_attempt_status) from public, anon, authenticated;
grant execute on function public.lm_site_form_status(public.lm_attempt_status) to service_role;
revoke all on function public.lm_attempts_record_site_form() from public, anon, authenticated;
revoke all on function public.lm_site_known_no_form(text) from public, anon, authenticated;
grant execute on function public.lm_site_known_no_form(text) to service_role;

-- Données existantes : le dernier constat de chaque site parmi les tentatives déjà faites par l'appli
insert into public.lm_site_forms (site_key, status, form_url, checked_at, source)
select distinct on (p.site_key)
       p.site_key, public.lm_site_form_status(a.status),
       case when public.lm_site_form_status(a.status) in ('form', 'protected') then left(a.form_url, 2000) end,
       a.updated_at, 'app'
  from public.lm_attempts a
  join public.lm_prospects p on p.id = a.prospect_id
 where public.lm_site_form_status(a.status) is not null
   and p.site_key is not null and p.site_key not like 'maps:%' and p.site_key not like 'tel:%'
 order by p.site_key, a.updated_at desc
on conflict (site_key) do nothing;
