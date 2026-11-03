alter table "public"."lm_sender_profiles" drop constraint "lm_sender_profiles_space_unique";

drop index if exists "public"."lm_sender_profiles_space_unique";

alter table "public"."lm_campaigns" add column "sender_id" uuid;

alter table "public"."lm_sender_profiles" add column "is_default" boolean not null default false;

-- Jusqu'ici un seul expéditeur par espace : chacun devient l'expéditeur par défaut de son espace
update public.lm_sender_profiles set is_default = true;

CREATE INDEX ix_lm_campaigns_sender_id ON public.lm_campaigns USING btree (sender_id) WHERE (sender_id IS NOT NULL);

CREATE INDEX ix_lm_sender_profiles_space_id ON public.lm_sender_profiles USING btree (space_id, created_at);

CREATE UNIQUE INDEX ux_lm_sender_profiles_default ON public.lm_sender_profiles USING btree (space_id) WHERE is_default;

alter table "public"."lm_campaigns" add constraint "lm_campaigns_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES public.lm_sender_profiles(id) ON DELETE SET NULL not valid;

alter table "public"."lm_campaigns" validate constraint "lm_campaigns_sender_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.lm_campaign_sender(p_campaign_id uuid)
 RETURNS SETOF public.lm_sender_profiles
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select s.*
    from public.lm_campaigns c
    join public.lm_sender_profiles s on s.space_id = c.space_id
   where c.id = p_campaign_id
     and (s.id = c.sender_id or (c.sender_id is null and s.is_default))
   limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_campaigns_check_sender()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.sender_id is not null and not exists (
    select 1 from public.lm_sender_profiles s where s.id = new.sender_id and s.space_id = new.space_id
  ) then
    raise exception 'sender not in campaign space' using errcode = '23514', hint = 'sender_space';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_sender_profiles_default_on_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.is_default then
    update public.lm_sender_profiles
       set is_default = true
     where id = (select s.id from public.lm_sender_profiles s
                  where s.space_id = old.space_id and s.id <> old.id
                  order by s.created_at, s.id
                  limit 1);
  end if;

  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_sender_profiles_default_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  new.is_default := not exists (
    select 1 from public.lm_sender_profiles s where s.space_id = new.space_id and s.is_default
  );

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lm_set_default_sender(p_sender_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sender public.lm_sender_profiles%rowtype;
begin
  select * into v_sender from public.lm_sender_profiles where id = p_sender_id;

  if v_sender.id is null
     or (current_setting('role', true) in ('authenticated', 'anon')
         and not (public.has_role_on_account(v_sender.account_id) and public.is_mfa_compliant())) then
    raise exception 'sender not found' using errcode = 'P0002';
  end if;

  -- deux temps : l'index unique partiel n'admet jamais deux expéditeurs par défaut, même un instant
  update public.lm_sender_profiles set is_default = false
   where space_id = v_sender.space_id and is_default and id <> p_sender_id;

  update public.lm_sender_profiles set is_default = true where id = p_sender_id and not is_default;
end;
$function$
;

grant delete on table "public"."lm_sender_profiles" to "authenticated";


  create policy "lm_sender_profiles_delete"
  on "public"."lm_sender_profiles"
  as permissive
  for delete
  to authenticated
using (public.has_permission(( SELECT auth.uid() AS uid), account_id, 'settings.manage'::public.app_permissions));


CREATE TRIGGER lm_campaigns_check_sender BEFORE INSERT OR UPDATE OF sender_id, space_id ON public.lm_campaigns FOR EACH ROW EXECUTE FUNCTION public.lm_campaigns_check_sender();

CREATE TRIGGER lm_sender_profiles_default_on_delete AFTER DELETE ON public.lm_sender_profiles FOR EACH ROW EXECUTE FUNCTION public.lm_sender_profiles_default_on_delete();

CREATE TRIGGER lm_sender_profiles_default_on_insert BEFORE INSERT ON public.lm_sender_profiles FOR EACH ROW EXECUTE FUNCTION public.lm_sender_profiles_default_on_insert();

-- Écrits à la main (migra ne les génère pas)
grant update (name, country_code, targeting, filters, templates, daily_limit, auto_validation, sender_id)
  on table public.lm_campaigns to authenticated;

revoke all on function public.lm_sender_profiles_default_on_insert() from public;
revoke all on function public.lm_sender_profiles_default_on_delete() from public;
revoke all on function public.lm_campaigns_check_sender() from public;

revoke all on function public.lm_set_default_sender(uuid) from public;
grant execute on function public.lm_set_default_sender(uuid) to authenticated, service_role;

revoke all on function public.lm_campaign_sender(uuid) from public;
grant execute on function public.lm_campaign_sender(uuid) to authenticated, service_role;

comment on table public.lm_sender_profiles is 'Identités utilisées pour remplir les formulaires (plusieurs par espace, une par défaut)';

-- La copie d'une campagne garde son expéditeur
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

  if v_source.id is null or not public.has_role_on_account(v_source.account_id) then
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
